/** Keyless assembled transcript for the broker-owned proposal protocol. */
import { spawn } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection } from 'node:net'
import { fileURLToPath } from 'node:url'
import { spawnBroker } from '../aukora/broker/broker.mjs'

const ISSUER_ENTRY = fileURLToPath(new URL('../aukora/issuer/issuer.mjs', import.meta.url))
const PROMPT = /\+- approve\? type "yes ([0-9a-f]{16})": /
const ARTIFACT_DIGEST = /approvalArtifactDigest: ([0-9a-f]{64})/
const LIVE_DOOR_ACTIVATION = 'ab'.repeat(32)
const LIVE_DOOR_RENDERER = 'cd'.repeat(32)

function brokerRequest(socketPath, request) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    let settled = false
    const finish = (fn) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      fn()
    }
    const timer = setTimeout(() => finish(() => reject(new Error('broker transcript request timed out'))), 5_000)
    socket.once('connect', () => { socket.write(`${JSON.stringify(request)}\n`) })
    socket.once('error', (error) => finish(() => reject(error)))
    socket.once('close', () => finish(() => reject(new Error('broker closed without a transcript reply'))))
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const cut = buffer.indexOf('\n')
      if (cut === -1) return
      finish(() => resolve(JSON.parse(buffer.slice(0, cut))))
    })
  })
}

async function waitForSocket(path, child, stderr) {
  const deadline = Date.now() + 5_000
  for (;;) {
    const connected = await new Promise((resolve) => {
      const socket = createConnection(path)
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => resolve(false))
    })
    if (connected) return
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`issuer exited before listening: ${stderr()}`)
    }
    if (Date.now() > deadline) throw new Error(`issuer did not listen: ${stderr()}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function waitForTerminal(socketPath, proposalNamespace, proposalId) {
  const deadline = Date.now() + 8_000
  for (;;) {
    const reply = await brokerRequest(socketPath, { op: 'proposal.status', proposalNamespace, proposalId })
    if (reply.state !== 'PENDING') return reply
    if (Date.now() > deadline) throw new Error('proposal transcript did not terminate')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    void promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

function exactPublicReply(reply, keys, label) {
  if (typeof reply !== 'object' || reply === null || Array.isArray(reply)) {
    throw new Error(`${label} was not a public record`)
  }
  const actual = Object.keys(reply).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} fields were ${actual.join(',')}; expected ${expected.join(',')}`)
  }
  const serialized = JSON.stringify(reply)
  for (const forbidden of ['grant', 'signature', 'nonce', 'digest', 'claims', 'receipt', 'arguments']) {
    if (serialized.includes(forbidden)) throw new Error(`${label} exposed ${forbidden}`)
  }
}

function stopChild(child, label) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} did not stop`)), 5_000)
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      resolve({ code, signal })
    })
    child.kill('SIGTERM')
  })
}

async function killChild(child) {
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.kill('SIGKILL')
  await exited
}

const tempDir = mkdtempSync(join(tmpdir(), 'aukora-proposal-transcript-'))
const brokerSocket = join(tempDir, 'broker.sock')
const issuerSocket = join(tempDir, 'issuer.sock')
const stateDir = join(tempDir, 'state')
let broker
let issuer
let parentReview = null

try {
  process.env.NODE_OPTIONS = `--require=${join(tempDir, 'ambient-preload-must-not-run.cjs')}`
  const root = generateKeyPairSync('ed25519')
  const rootPublicKeyPem = root.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const rootKeyFile = join(tempDir, 'root.pem')
  writeFileSync(rootKeyFile, root.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), { mode: 0o600 })
  chmodSync(rootKeyFile, 0o600)

  broker = await spawnBroker({
    socketPath: brokerSocket,
    stateDir,
    rootPublicKeyPem,
    issuerSocket,
    activationDigest: LIVE_DOOR_ACTIVATION,
    rendererId: LIVE_DOOR_RENDERER,
    review: async (request) => {
      if (parentReview !== null) throw new Error('transcript received a second parent review')
      parentReview = request
      return 'approved'
    },
  })
  const status = await brokerRequest(brokerSocket, { op: 'status' })
  if (typeof status.receiptKeyId !== 'string') throw new Error('broker status omitted receipt key identity')
  const opened = await brokerRequest(brokerSocket, { op: 'proposal.open' })
  exactPublicReply(opened, ['ok', 'proposalNamespace'], 'proposal.open')
  if (typeof opened.proposalNamespace !== 'string') throw new Error('broker omitted proposal namespace')

  let issuerStderr = ''
  let pendingPrompt = ''
  let promptDigest = null
  let resolvePrompt
  const promptSeen = new Promise((resolve) => { resolvePrompt = resolve })
  issuer = spawn(process.execPath, [ISSUER_ENTRY], {
    env: {
      AUKORA_ISSUER_SOCKET: issuerSocket,
      AUKORA_ISSUER_KEY_FILE: rootKeyFile,
      AUKORA_EXPECTED_RECEIPT_KEY_ID: status.receiptKeyId,
    },
    stdio: ['pipe', 'ignore', 'pipe'],
  })
  issuer.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8')
    issuerStderr += text
    pendingPrompt += text
    promptDigest ??= ARTIFACT_DIGEST.exec(issuerStderr)?.[1] ?? null
    const match = PROMPT.exec(pendingPrompt)
    if (match === null) return
    pendingPrompt = pendingPrompt.slice(match.index + match[0].length)
    issuer.stdin.write(`yes ${match[1]}\n`)
    resolvePrompt()
  })
  await waitForSocket(issuerSocket, issuer, () => issuerStderr)

  const request = {
    op: 'proposal.deposit',
    proposalNamespace: opened.proposalNamespace,
    callId: 'snapshot-call',
    toolName: 'memory.put',
    arguments: { key: 'snapshot', value: { approved: true } },
  }
  const pending = await brokerRequest(brokerSocket, request)
  exactPublicReply(pending, ['ok', 'proposalId', 'state'], 'proposal.deposit')
  if (typeof pending.proposalId !== 'string') throw new Error('deposit omitted proposal id')
  await withTimeout(promptSeen, 5_000, 'issuer prompt was not observed')
  const terminal = await waitForTerminal(brokerSocket, opened.proposalNamespace, pending.proposalId)
  exactPublicReply(terminal, ['ok', 'proposalId', 'state'], 'proposal.status')
  if (parentReview === null
    || parentReview.type !== 'aukora:review-request:v2'
    || parentReview.proposalId !== pending.proposalId
    || parentReview.artifact?.operationDigest !== parentReview.operationDigest
    || parentReview.artifact?.expiry !== parentReview.expiresAt
    || parentReview.artifactDigest !== promptDigest) {
    throw new Error('parent review did not bind the settled operation and issuer artifact')
  }
  const retry = await brokerRequest(brokerSocket, request)
  exactPublicReply(retry, ['ok', 'proposalId', 'state'], 'proposal.retry')
  const conflict = await brokerRequest(brokerSocket, {
    ...request,
    arguments: { key: 'snapshot', value: { approved: false } },
  })
  exactPublicReply(conflict, ['ok', 'reason', 'state'], 'proposal.conflict')
  const objectCount = readdirSync(join(stateDir, 'memory', 'objects')).filter(name => name.endsWith('.json')).length
  const auraEntries = readFileSync(join(stateDir, 'aura.jsonl'), 'utf8').trim().split('\n').length
  const brokerExit = await stopChild(broker, 'broker')
  const issuerExit = await stopChild(issuer, 'issuer')

  const transcript = [
    { brokerPreloadEnv: status.env.NODE_OPTIONS, event: 'environment.scrubbed', issuerEnvironment: 'ALLOWLISTED' },
    {
      artifactDigest: '<artifact-digest>',
      event: 'parent.review',
      mode: 'SIMULATED HUMAN',
      operationDigest: '<operation-digest>',
    },
    { event: 'proposal.deposit', ok: pending.ok, proposalId: '<proposal-id>', state: pending.state },
    { event: 'issuer.prompt', artifactDigest: promptDigest === null ? null : '<artifact-digest>', mode: 'SIMULATED HUMAN' },
    { event: 'proposal.status', ok: terminal.ok, proposalId: '<proposal-id>', state: terminal.state },
    { auraEntries, event: 'external.observation', objectCount },
    { event: 'proposal.retry', sameProposal: retry.proposalId === pending.proposalId, state: retry.state },
    { event: 'proposal.conflict', ok: conflict.ok, reason: conflict.reason, state: conflict.state },
    { brokerExit: brokerExit.code, event: 'shutdown', issuerExit: issuerExit.code },
  ]
  process.stdout.write(`${transcript.map(row => JSON.stringify(row)).join('\n')}\n`)
} finally {
  await Promise.allSettled([killChild(broker), killChild(issuer)])
  rmSync(tempDir, { recursive: true, force: true })
}
