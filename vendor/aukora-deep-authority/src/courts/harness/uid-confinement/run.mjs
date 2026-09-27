/**
 * courts/harness/uid-confinement — the OS-confined guest -> broker slice.
 *
 * The broker owns the state directory (mode 0700, its own uid) and the one
 * effect; the guest runs under a DIFFERENT uid and holds nothing but the
 * socket path and a shared scratch dir. The kernel denies the guest any reach
 * into the state, so the boundary is enforced by the OS, not by code in the
 * guest. The broker re-verifies every signed request at execution time.
 *
 * WHAT IS ACTUALLY LINUX-ONLY HERE, STATED PRECISELY. It is this court's
 * MECHANISM, not the uid split as such. On the measured Darwin host, `setpriv`
 * is absent and `sudo -n` requires a password, so the court cannot obtain a second
 * uid without a human at the keyboard — but service accounts do exist, so the ingredients for a
 * split exist and it is UNATTENDED operation that fails, not the platform. On
 * Linux the court runs the broker and the guest as two uids through privileged
 * `setpriv --reuid=…` after the root bootstrap.
 *
 * The half of the boundary that DOES hold on every platform — the broker
 * refusing to boot on a state directory it does not exclusively own, and the
 * confinement class carried inside every receipt signature — is graded by
 * courts/harness/confinement, which runs green on darwin instead of skipping.
 *
 *   L1 liveness   guest and broker are live processes under distinct uids
 *   L2 denied     the kernel refuses the guest a read of the broker's state
 *   L3 valid      a valid grant writes + receipt verifies + Aura records it
 *   L4 refusals   absent/forged/expired/replayed/reordered/Unicode/swapped
 *   L5 gate       refused requests leave no state — the verifier is the gate
 *   L6 fake root  a grant from a non-root key (a fake aukora service) refuses
 *   L7 guest env  fixture strips an injected guest NODE_OPTIONS preload;
 *                 traversal/symlink denied by kernel
 *   L8 mutation   --mutate removes confinement and the court detects it
 *   L9 limitation this court's sudo/setpriv mechanism needs Linux; the
 *                 platform-independent half is graded by courts/harness/confinement
 *
 *   node courts/harness/uid-confinement/run.mjs
 *   node courts/harness/uid-confinement/run.mjs --mutate
 */
import { generateKeyPairSync, sign as edSign } from 'node:crypto'
import { mkdtempSync, mkdirSync, chmodSync, chownSync, statSync, readdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { connect } from 'node:net'
import { copyMutantAukora } from '../support/mutant-aukora.mjs'
import { buildOperation, operationDigest } from '../../../aukora/broker/operation.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const { payloadDigest, grantPreimage, newNonce, receiptKeyIdForPublicKey, REFUSE } = await import(join(ROOT, 'aukora/host-dsh/src/grant.mjs'))
const { definitionDigest, MEMORY_PUT, observe } = await import(join(ROOT, 'aukora/broker/effect.mjs'))
const { scrubEnv } = await import(join(ROOT, 'aukora/broker/broker.mjs'))
const { verifyReceipt } = await import(join(ROOT, 'aukora/broker/receipt.mjs'))
const { verifyChain, readEntries } = await import(join(ROOT, 'aukora/aura/record.mjs'))

const IS_LINUX = process.platform === 'linux'
const MUTATE = process.argv.includes('--mutate')
const BROKER_UID = 60001
const GUEST_UID = 60002

const EXPECTED_ROWS = Object.freeze(['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'])
const rows = []
const row = (n, label, observed, expected) => {
  rows.push({ n, label, observed, expected, breach: JSON.stringify(observed) !== JSON.stringify(expected) })
}

/** Require every ordinary row exactly once. */
const rowsComplete = () => {
  const names = new Set(rows.map(({ n }) => n))
  return rows.length === EXPECTED_ROWS.length
    && names.size === EXPECTED_ROWS.length
    && EXPECTED_ROWS.every((name) => names.has(name))
}

/** Require the confinement-removal blast radius and the liveness control exactly. */
const mutationRowsMatch = (expectedBreaches) => {
  const expected = new Set(expectedBreaches)
  const names = new Set(rows.map(({ n }) => n))
  return rowsComplete()
    && expected.size === expectedBreaches.length
    && names.size === rows.length
    && expectedBreaches.every((name) => names.has(name))
    && rows.every(({ n, breach }) => breach === expected.has(n))
}

// ---------------------------------------------------------------------------
// L9 — the uid split does not exist on this host.
// ---------------------------------------------------------------------------
if (!IS_LINUX) {
  console.log('\n  courts/harness/uid-confinement — the OS-confined guest -> broker slice\n  ' + '-'.repeat(72))
  console.log(`  L9  limitation  this court's sudo/setpriv mechanism needs Linux; this host is ${process.platform} — skipped honestly, not faked`)
  console.log('      The platform-independent half — boot refusal on a state dir this uid does not')
  console.log('      exclusively own, and the signed confinement class — is graded green here by')
  console.log('      courts/harness/confinement. This row is about the SECOND UID, nothing else.')
  console.log('\n  observationClass: SKIP (platform-gated)\n')
  // 77 = SKIPPED-by-design. Never counted as a pass: a green gate on a Mac
  // must not claim the strongest Linux-only result it never ran.
  process.exit(77)
}

const SELF = fileURLToPath(import.meta.url)

// Re-exec as root. The court is the trusted observer: it reads the broker's
// 0700 state to verify the effect, and it spawns the broker and guest as two
// distinct uids. Without root it can do neither, so it fails closed rather
// than half-running a slice that silently dropped the confinement.
if (process.getuid() !== 0) {
  const privilege = spawnSync('sudo', ['-n', 'true'], { stdio: 'inherit' })
  if (privilege.status !== 0) {
    console.error('uid-confinement: cannot gain root (sudo) to split uids — failing closed')
    process.exit(privilege.status ?? 1)
  }
  const r = spawnSync('sudo', ['-n', process.execPath, SELF, ...process.argv.slice(2)], { stdio: 'inherit' })
  process.exit(r.status ?? 1)
}

function setprivAs(uid, args, opts = {}) {
  const groupArgs = opts.groups === undefined
    ? ['--clear-groups']
    : ['--groups', opts.groups.join(',')]
  return spawnSync('setpriv', [`--reuid=${uid}`, `--regid=${uid}`, ...groupArgs, ...args], {
    input: opts.input,
    encoding: 'utf8',
    // Scrub the completed child environment, not only its inherited portion:
    // an input cannot reintroduce a preload name through `opts.env`.
    env: scrubEnv({ ...process.env, ...(opts.env ?? {}) }),
  })
}

function sudoRmRf(path) {
  // The state dir is 0700 owned by the broker's uid, so the court (a third
  // uid) cannot rmdir it. Cleanup is delegated to root.
  spawnSync('sudo', ['-n', 'rm', '-rf', path])
}

function accepts(path) {
  return new Promise((resolve) => {
    const s = connect(path)
    s.once('connect', () => { s.destroy(); resolve(true) })
    s.once('error', () => resolve(false))
  })
}

async function waitForSocket(path, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await accepts(path)) return
    await delay(20)
  }
  throw new Error(`broker socket did not accept within ${timeoutMs}ms`)
}

const TMP = mkdtempSync(join(tmpdir(), 'aukora-uid-'))
const stateDir = join(TMP, 'state')
const socketDir = join(TMP, 'socket')
const guestScratchDir = join(TMP, 'guest-scratch')
const socketPath = join(socketDir, 'broker.sock')
// The guest must traverse these names, but must never be able to replace a
// broker-owned child through an ancestor. The root-owned parent is
// guest-traversable without being writable; state and socket directories are
// pre-created for the broker, while the only writable scratch directory is
// owned by the guest.
chmodSync(TMP, 0o711)
mkdirSync(stateDir, { recursive: true, mode: 0o700 })
chownSync(stateDir, BROKER_UID, BROKER_UID)
chmodSync(stateDir, 0o700)
mkdirSync(socketDir, { recursive: true, mode: 0o710 })
chownSync(socketDir, BROKER_UID, BROKER_UID)
chmodSync(socketDir, 0o710)
mkdirSync(guestScratchDir, { recursive: true, mode: 0o700 })
chownSync(guestScratchDir, GUEST_UID, GUEST_UID)
chmodSync(guestScratchDir, 0o700)

// Copy the broker + guest source into the world-readable temp tree. The
// checkout can sit under a home dir another uid cannot traverse, and the
// broker/guest run as different uids; the state (never the source) is what
// stays confined. Relative imports resolve inside the copy.
copyMutantAukora(join(TMP, 'aukora'))
const BROKER_ENTRY = join(TMP, 'aukora', 'broker', 'broker.mjs')
const GUEST_ENTRY = join(TMP, 'aukora', 'guest', 'guest.mjs')

const root = generateKeyPairSync('ed25519')
const rootPem = root.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const fakeRoot = generateKeyPairSync('ed25519') // the fake aukora service's own key
const DEF = definitionDigest()

let brokerReceiptKeyId = null
const mint = (toolName, args, { signer = root.privateKey, nonce = newNonce(), exp } = {}) => {
  const nowSec = Math.floor(Date.now() / 1000)
  const g = {
    toolName, digest: payloadDigest(toolName, args), nonce,
    exp: exp ?? nowSec + 300, definitionId: DEF, operationDigest: operationDigest(buildOperation(args, exp ?? nowSec + 300)),
    receiptKeyId: brokerReceiptKeyId,
  }
  return { ...g, signature: edSign(null, grantPreimage(g), signer).toString('base64') }
}

// This court needs a second UID, so it launches the canonical broker entry
// through `setpriv` rather than `spawnBroker()`. The broker court separately
// owns direct-child IPC and canonical-helper coverage. Build this fixture's
// environment through the production scrubber and inject a hostile
// NODE_OPTIONS value; an unsanitized launch would fail before the broker binds.
const brokerEnv = {
  ...scrubEnv({
    ...process.env,
    NODE_OPTIONS: '--require=/aukora-uid-court-preload-must-not-run.cjs',
  }),
  // These three values are trusted fixture inputs, set after scrubbing in the
  // same order the production helper uses for its canonical launch.
  AUKORA_SOCKET: socketPath,
  AUKORA_STATE_DIR: stateDir,
  AUKORA_ROOT_PEM: rootPem,
  AUKORA_SOCKET_GROUP_ACCESS: '1',
}
const broker = spawn('setpriv', [
  `--reuid=${BROKER_UID}`, `--regid=${BROKER_UID}`, '--clear-groups',
  process.execPath, BROKER_ENTRY,
], {
  env: brokerEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
})
broker.stdout?.on('data', () => {}) // drain so the broker never blocks on a full pipe
let brokerErr = ''
broker.stderr?.on('data', (d) => { brokerErr += d })

try {
  // The installed-job route is published directly as 0660 in a 0710 directory
  // owned by the broker's effective group. Wait for the fixed route instead of
  // widening the live socket after bind, which must be detected as route loss.
  {
    const deadline = Date.now() + 10000
    while (!existsSync(socketPath)) {
      if (Date.now() > deadline) throw new Error(`broker socket file did not appear within 10s${brokerErr ? `: ${brokerErr.slice(0, 500)}` : ''}`)
      await delay(20)
    }
  }
  await waitForSocket(socketPath)
  const brokerKeyRecord = JSON.parse(readFileSync(join(stateDir, 'keys', 'broker.json'), 'utf8'))
  brokerReceiptKeyId = receiptKeyIdForPublicKey(brokerKeyRecord.publicPem)

  if (MUTATE) {
    // Sabotage: remove the OS confinement by opening the state to everyone.
    spawnSync('sudo', ['-n', 'chmod', '777', stateDir])
  }

  const brokerUid = statSync(stateDir).uid

  // Build the request stream. One valid grant first (L3), then the battery.
  const validArgs = { key: 'user:balance', value: 1000 }
  const validGrant = mint(MEMORY_PUT, validArgs, { nonce: 'uid-valid-01' })

  const forgedArgs = { key: 'forged', value: 1 }
  const forgedGrant = mint(MEMORY_PUT, forgedArgs, { nonce: 'uid-forged-01' })
  const sig = Buffer.from(forgedGrant.signature, 'base64')
  sig[0] ^= 0xff
  forgedGrant.signature = sig.toString('base64')

  const reorderedArgs = { key: 'reordered', value: [1, 2, 3] }
  const reorderedGrant = mint(MEMORY_PUT, reorderedArgs, { nonce: 'uid-reordered-01' })
  const driftedArgs = { key: 'drifted', value: 'caf\u00e9' }
  const driftedGrant = mint(MEMORY_PUT, driftedArgs, { nonce: 'uid-drifted-01' })
  const swappedArgs = { key: 'swapped', value: 1 }
  const swappedGrant = mint('net:outbound', swappedArgs, { nonce: 'uid-swapped-01' })
  const fakeGrant = mint(MEMORY_PUT, { key: 'fake', value: 1 }, { signer: fakeRoot.privateKey, nonce: 'uid-fake-01' })

  const requests = [
    { id: 'valid', op: 'memory.put', toolName: MEMORY_PUT, arguments: validArgs, grant: validGrant },
    { id: 'absent', op: 'memory.put', toolName: MEMORY_PUT, arguments: { key: 'x', value: 1 } },
    { id: 'forged', op: 'memory.put', toolName: MEMORY_PUT, arguments: forgedArgs, grant: forgedGrant },
    { id: 'expired', op: 'memory.put', toolName: MEMORY_PUT, arguments: { key: 'x', value: 1 }, grant: mint(MEMORY_PUT, { key: 'x', value: 1 }, { nonce: 'uid-expired-01', exp: Math.floor(Date.now() / 1000) - 100 }) },
    { id: 'replayed', op: 'memory.put', toolName: MEMORY_PUT, arguments: validArgs, grant: validGrant },
    { id: 'reordered', op: 'memory.put', toolName: MEMORY_PUT, arguments: { key: 'reordered', value: [3, 2, 1] }, grant: reorderedGrant },
    { id: 'drifted', op: 'memory.put', toolName: MEMORY_PUT, arguments: { key: 'drifted', value: 'cafe\u0301' }, grant: driftedGrant },
    { id: 'swapped', op: 'memory.put', toolName: MEMORY_PUT, arguments: swappedArgs, grant: swappedGrant },
    { id: 'fake', op: 'memory.put', toolName: MEMORY_PUT, arguments: { key: 'fake', value: 1 }, grant: fakeGrant },
  ]

  const stdin = requests.map((r) => JSON.stringify(r)).join('\n') + '\n'
  const guest = setprivAs(GUEST_UID, [process.execPath, GUEST_ENTRY, socketPath, stateDir, guestScratchDir], {
    input: stdin,
    env: { NODE_OPTIONS: '--require=/aukora-uid-court-preload-must-not-run.cjs' },
    groups: [BROKER_UID],
  })
  if (guest.status !== 0) {
    throw new Error(`guest exited ${guest.status}: ${(guest.stderr ?? '').slice(0, 500)}`)
  }

  const parsed = {}
  const replies = []
  for (const line of (guest.stdout ?? '').split('\n').filter(Boolean)) {
    const sp = line.indexOf(' ')
    const label = line.slice(0, sp)
    const payload = line.slice(sp + 1)
    if (label === 'REPLY') replies.push(JSON.parse(payload))
    else parsed[label] = JSON.parse(payload)
  }
  const reply = (id) => replies.find((r) => r.id === id)

  // L1 — liveness: both processes ran, under distinct uids.
  const guestUid = parsed.UID?.uid
  row('L1', 'guest and broker are live processes under distinct uids', {
    connected: parsed.CONNECTED?.ok === true,
    guestUid,
    brokerUid,
    distinct: Number.isInteger(guestUid) && guestUid === GUEST_UID && brokerUid === BROKER_UID && guestUid !== brokerUid,
  }, { connected: true, guestUid: GUEST_UID, brokerUid: BROKER_UID, distinct: true })

  // L2 — the kernel denies the guest a read of the broker's state.
  const denied = parsed.STATE_ACCESS
  row('L2', 'the kernel refuses the guest a read of the broker state', {
    ok: denied?.ok === false && ['EACCES', 'EPERM'].includes(denied?.code),
    code: denied?.code,
  }, { ok: true, code: denied?.code })

  // L3 — a valid grant writes; the receipt verifies; Aura records it.
  const v = reply('valid') ?? {}
  const receiptOk = v.ok === true ? (verifyReceipt({ receipt: v.receipt, brokerPublicKeyPem: v.brokerPublicKeyPem, observe }).ok === true) : false
  const chainFile = join(stateDir, 'aura.jsonl')
  const chain = verifyChain(chainFile)
  const entries = readEntries(chainFile)
  row('L3', 'a valid grant writes; receipt verifies; Aura records it', {
    admitted: v.ok === true,
    receiptOk,
    chainOk: chain.ok === true,
    entries: chain.count,
  }, { admitted: true, receiptOk: true, chainOk: true, entries: 1 })

  // L4 — the refusal battery, each refused by its own name.
  const refuse = (id) => {
    const r = reply(id)
    return r && r.ok === false ? r.reason : (r?.ok ?? 'missing-reply')
  }
  row('L4', 'absent/forged/expired/replayed/reordered/Unicode/swapped each refuse by name', {
    absent: refuse('absent'), forged: refuse('forged'), expired: refuse('expired'),
    replayed: refuse('replayed'), reordered: refuse('reordered'),
    drifted: refuse('drifted'), swapped: refuse('swapped'),
  }, {
    absent: REFUSE.NO_GRANT, forged: REFUSE.BAD_SIGNATURE, expired: REFUSE.EXPIRED,
    replayed: REFUSE.REPLAYED, reordered: REFUSE.PAYLOAD_MISMATCH,
    drifted: REFUSE.PAYLOAD_MISMATCH, swapped: REFUSE.TOOL_MISMATCH,
  })

  // L5 — the verifier is the only gate: refused requests left no state.
  // Existence-guarded: under --mutate the state dir is chmod 777 before the
  // requests run, the broker's per-request confinement gate refuses every one
  // of them, and nothing is ever written — so the objects directory does not
  // exist. An unguarded readdirSync would throw ENOENT and abort the arm before
  // it could report what it detected.
  const objectsDir = join(stateDir, 'memory', 'objects')
  const objects = existsSync(objectsDir) ? readdirSync(objectsDir).filter((f) => f.endsWith('.json')) : []
  row('L5', 'refused requests left no state — the verifier is the only gate', {
    objects: objects.length,
    entries: chain.count,
  }, { objects: 1, entries: 1 })

  // L6 — a grant from a non-root key (a fake aukora service) refuses.
  row('L6', "a non-root key cannot mint authority (fake 'aukora' service)", { reason: refuse('fake') }, { reason: REFUSE.BAD_SIGNATURE })

  // L7 — the fixture strips a preload from the guest launch; traversal and
  // symlink access still need the kernel denial rather than a guest convention.
  row('L7', 'guest launch strips injected NODE_OPTIONS; traversal and symlink denied by kernel', {
    nodeOptions: parsed.ENV?.NODE_OPTIONS,
    traversal: parsed.TRAVERSAL?.ok === false && ['EACCES', 'EPERM'].includes(parsed.TRAVERSAL?.code),
    symlink: parsed.SYMLINK?.ok === false && ['EACCES', 'EPERM'].includes(parsed.SYMLINK?.code),
  }, { nodeOptions: null, traversal: true, symlink: true })

  console.log('\n  courts/harness/uid-confinement — the OS-confined guest -> broker slice\n  ' + '-'.repeat(72))
  for (const r of rows) {
    console.log(`  ${r.n}  ${String(r.label).padEnd(58)} ${JSON.stringify(r.observed) === JSON.stringify(r.expected) ? 'held' : '*** BREACH ***'}  ${JSON.stringify(r.observed).slice(0, 160)}`)
  }

  if (MUTATE) {
    // The sabotage opened the state dir; the guest's probe must now succeed.
    const expectedBreaches = ['L2', 'L3', 'L4', 'L5', 'L6', 'L7']
    const stateReached = parsed.STATE_ACCESS?.ok === true
    const ordinaryRowsMatched = mutationRowsMatch(expectedBreaches)
    const detected = stateReached && ordinaryRowsMatched
    console.log(`\n  MUTATION confinement removed (state 0777)  stateReached=${stateReached} expectedBreaches=[${expectedBreaches.join(' ')}] ordinaryRowsMatched=${ordinaryRowsMatched}  ${detected ? 'DETECTED' : 'NOT DETECTED'}\n`)
    sudoRmRf(TMP)
    process.exit(detected ? 0 : 1)
  }

  const anyBreach = rows.some((r) => r.breach)
  console.log('\n  observationClass: SELF-REPORTED\n')
  sudoRmRf(TMP)
  process.exit(anyBreach || !rowsComplete() ? 1 : 0)
} finally {
  try { process.kill(-broker.pid, 'SIGTERM') } catch { /* already gone */ }
  await delay(100)
  sudoRmRf(TMP)
}
