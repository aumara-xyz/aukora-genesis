/** Mutation control for the broker-proposal effect-admission verifier. */
import { afterEach, describe, expect, it } from 'vitest'
import { generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection, createServer, type Socket } from 'node:net'
import type { ChildProcess } from 'node:child_process'
import { authorizationSignedMessageFromHex } from '@aukora/core/host-dsh/src/grant.mjs'
import { spawnMutantBroker } from '../../../../courts/harness/support/spawn-mutant-broker.mjs'

const MUTANT_ENTRY = process.env.AUKORA_PROPOSAL_MUTANT_ENTRY
const SENTINEL = process.env.AUKORA_PROPOSAL_MUTATION_SENTINEL

let broker: ChildProcess | undefined
let closeIssuer: (() => Promise<void>) | undefined
let tempDir: string | undefined

function request(socketPath: string, frame: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('proposal verifier request timed out')) }, 5_000)
    socket.once('connect', () => { socket.write(`${JSON.stringify(frame)}\n`) })
    socket.once('error', reject)
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const cut = buffer.indexOf('\n')
      if (cut === -1) return
      clearTimeout(timer)
      socket.destroy()
      resolve(JSON.parse(buffer.slice(0, cut)) as Record<string, unknown>)
    })
  })
}

async function terminal(socketPath: string, proposalNamespace: string, proposalId: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 5_000
  for (;;) {
    const reply = await request(socketPath, { op: 'proposal.status', proposalNamespace, proposalId })
    if (reply.state !== 'PENDING') return reply
    if (Date.now() > deadline) throw new Error('proposal verifier intervention did not terminate')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function issuer(path: string, key: KeyObject): Promise<() => Promise<void>> {
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    let buffer = ''
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const cut = buffer.indexOf('\n')
      if (cut === -1) return
      socket.removeAllListeners('data')
      const frame = JSON.parse(buffer.slice(0, cut)) as { op: string; digest: string }
      socket.end(`${JSON.stringify(frame.op === 'admit'
        ? { ok: true }
        : {
          ok: true,
          digest: frame.digest,
          signature: edSign(null, authorizationSignedMessageFromHex(frame.digest), key).toString('base64'),
        })}\n`)
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => { server.removeListener('error', reject); resolve() })
  })
  return async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
  }
}

function count(path: string): number {
  return existsSync(path) ? readdirSync(path).length : 0
}

afterEach(async () => {
  if (broker !== undefined && broker.exitCode === null && broker.signalCode === null) {
    const exited = new Promise(resolve => broker?.once('exit', resolve))
    broker.kill('SIGTERM')
    await exited
  }
  await closeIssuer?.()
  if (tempDir !== undefined) rmSync(tempDir, { recursive: true, force: true })
  broker = undefined
  closeIssuer = undefined
  tempDir = undefined
})

describe('broker-proposal effect-admission verifier', () => {
  it.skipIf(MUTANT_ENTRY === undefined || SENTINEL === undefined)(
    'refuses an artifact changed after issuer verification and before effect admission',
    async () => {
      if (MUTANT_ENTRY === undefined || SENTINEL === undefined) {
        throw new Error('broker-proposal mutation fixture was not configured')
      }
      tempDir = mkdtempSync(join(tmpdir(), 'aukora-proposal-verifier-'))
      const stateDir = join(tempDir, 'state')
      const brokerSocket = join(tempDir, 'broker.sock')
      const issuerSocket = join(tempDir, 'issuer.sock')
      const root = generateKeyPairSync('ed25519')
      closeIssuer = await issuer(issuerSocket, root.privateKey)
      broker = await spawnMutantBroker({
        entry: MUTANT_ENTRY,
        socketPath: brokerSocket,
        stateDir,
        rootPublicKeyPem: root.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        issuerSocket,
        activationDigest: 'ab'.repeat(32),
        rendererId: 'cd'.repeat(32),
      })
      const opened = await request(brokerSocket, { op: 'proposal.open' })
      if (typeof opened.proposalNamespace !== 'string') throw new Error('mutation broker omitted proposal namespace')
      const pending = await request(brokerSocket, {
        op: 'proposal.deposit',
        proposalNamespace: opened.proposalNamespace,
        callId: 'post-issuer-artifact-change',
        toolName: 'memory.put',
        arguments: { key: 'verifier:mutation', value: true },
      })
      if (typeof pending.proposalId !== 'string') throw new Error('mutation broker omitted proposal id')
      const result = await terminal(brokerSocket, opened.proposalNamespace, pending.proposalId)
      const auraPath = join(stateDir, 'aura.jsonl')
      const observation = {
        aura: existsSync(auraPath) ? readFileSync(auraPath, 'utf8').trim().split('\n').filter(Boolean).length : 0,
        nonces: count(join(stateDir, 'nonces')),
        objects: count(join(stateDir, 'memory', 'objects')),
        state: result.state,
      }
      writeFileSync(SENTINEL, `${JSON.stringify(observation)}\n`, 'utf8')
      expect(observation).toEqual({ aura: 0, nonces: 0, objects: 0, state: 'REFUSED' })
    },
    15_000,
  )
})
