/**
 * Real broker-process coverage for the receipt inspection route.
 *
 * The evidence is produced by a REAL broker settling a REAL operation on
 * disposable state, because a hand-built fixture would let this test agree with
 * its own assumptions about what a settlement looks like.
 *
 * THE ASSERTIONS KEEP THREE FACTS APART: what the chain recorded, whether the
 * document's signatures verify, and who the evidence shows approved. A settled
 * operation with no owner key legitimately carries a NON-CONFORMING document and
 * a null approval class, so a test that expected one verdict for both facts would
 * hide exactly the distinction the viewer exists to show.
 */
import { createConnection } from 'node:net'
import { createHash, generateKeyPairSync, sign as edSign } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import {
  provisionBrokerIdentity,
  spawnBroker,
} from '@aukora/core/broker/broker.mjs'
import { MEMORY_PUT } from '@aukora/core/broker/effect-definition.mjs'
import { payloadDigest, newNonce, grantPreimage } from '@aukora/core/host-dsh/src/grant.mjs'
import { buildOperation, operationDigest } from '@aukora/core/broker/operation.mjs'
import { definitionDigest } from '@aukora/core/broker/effect-definition.mjs'
import {
  requestBrokerReceiptInspect,
  readReceiptInspectReply,
} from '@deepseek-ai/dsh-aukora-memory/src/proposal-client.ts'

const roots: string[] = []
const children: Array<import('node:child_process').ChildProcess> = []

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      await once(child, 'exit')
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A line-protocol client, because the broker speaks its own framed socket. */
function client(socket: string) {
  const connection = createConnection(socket)
  let buffer = ''
  const pending = new Map<number, (reply: Record<string, unknown>) => void>()
  connection.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    let cut: number
    while ((cut = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 1)
      if (line.trim() === '') continue
      const reply = JSON.parse(line) as Record<string, unknown>
      const waiter = pending.get(reply.id as number)
      if (waiter !== undefined) {
        pending.delete(reply.id as number)
        waiter(reply)
      }
    }
  })
  let next = 1
  return {
    ready: new Promise<void>(resolve => connection.once('connect', () => resolve())),
    send: (frame: Record<string, unknown>) => new Promise<Record<string, unknown>>((resolve) => {
      const id = next++
      pending.set(id, resolve)
      connection.write(`${JSON.stringify({ id, ...frame })}\n`)
    }),
    close: () => connection.end(),
  }
}

/** Read the Aura chain entries this broker appended, in file order. */
function readChainEntries(stateDir: string): Array<Record<string, unknown>> {
  return readFileSync(join(stateDir, 'aura.jsonl'), 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as Record<string, unknown>)
}

/**
 * Launch one broker over disposable state and settle one memory.put through it.
 * @returns the socket, the settled receipt digest, and the chain entry's digest.
 */
async function settledStore() {
  const root = mkdtempSync(join(tmpdir(), 'aukora-receipt-inspect-broker-'))
  roots.push(root)
  const stateDir = join(root, 'state')
  mkdirSync(stateDir, { mode: 0o700 })
  const socketPath = join(root, 'broker.sock')
  const receiptKeyId = provisionBrokerIdentity(stateDir).receiptKeyId
  const rootPair = generateKeyPairSync('ed25519')
  const rootPem = rootPair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const broker = await spawnBroker({ socketPath, stateDir, rootPublicKeyPem: rootPem })
  children.push(broker)

  const cli = client(socketPath)
  await cli.ready
  const key = 'receipt-inspect-broker-subject'
  const args = { key, value: { text: 'inspected' } }
  const exp = Math.floor(Date.now() / 1000) + 300
  const claims = {
    toolName: MEMORY_PUT,
    digest: payloadDigest(MEMORY_PUT, args),
    nonce: newNonce(),
    exp,
    definitionId: definitionDigest(),
    operationDigest: operationDigest(buildOperation(args, exp)),
    receiptKeyId,
  }
  const settled = await cli.send({
    op: 'memory.put',
    toolName: MEMORY_PUT,
    arguments: args,
    grant: { ...claims, signature: edSign(null, grantPreimage(claims), rootPair.privateKey).toString('base64') },
  })
  expect(settled.ok, `settlement refused: ${String(settled.reason ?? settled.refusal)}`).toBe(true)
  expect(settled.state).toBe('SETTLED')
  // The identifier comes from the CHAIN, not from the reply: the chain entry is
  // what an inspector would look an identifier up in, so taking it from anywhere
  // else would let this test agree with a field the chain never recorded.
  const entry = readChainEntries(stateDir).find(candidate => candidate.sequence === 1)
  const receiptSha256 = entry?.receiptSha256 as string
  expect(receiptSha256).toMatch(/^[0-9a-f]{64}$/u)
  return { root, stateDir, socketPath, receiptSha256, cli }
}

describe('broker receipt inspection', () => {
  it('separates settlement, verification verdict and approval attribution', async () => {
    const store = await settledStore()
    const controller = new AbortController()
    const result = await requestBrokerReceiptInspect(store.socketPath, store.receiptSha256, controller.signal)

    expect(result.refusal).toBeUndefined()
    expect(result.settlement.state).toBe('settled')
    expect(result.settlement.sequence).toBeGreaterThan(0)
    expect(result.settlement.subject).toBe('receipt-inspect-broker-subject')
    expect(result.settlement.operation).toBe('memory.put')
    expect(result.settlement.chainHash).toMatch(/^[0-9a-f]{64}$/u)
    expect(result.evidence.v1Available).toBe(true)
    expect(result.limitations).toContain('SAME_UID_HOST')
    // The owner role is reported, and reported as unavailable: no owner key is
    // registered anywhere in this tree. Omitting the row would read as "no owner
    // role exists" rather than "the role could not be checked".
    const owner = result.trustInputs.find(row => row.role === 'owner')
    expect(owner?.status).toBe('unavailable')
    expect(result.trustInputs.map(row => row.role)).toEqual(['executor', 'issuer', 'owner'])
    // The verdict is a SEPARATE field from the settlement state, and this store
    // settles an operation whose document cannot conform: the approval class is
    // `unattributed` because no owner key is registered, which is neither a
    // failure to settle nor a claim that a human approved.
    expect(['CONFORMING', 'NON-CONFORMING']).toContain(result.verification?.verdict)
    expect(result.verification?.verdict).toBe('NON-CONFORMING')
    expect(result.verification?.approvalClass).toBe('unattributed')
    expect(result.settlement.state).toBe('settled')
    expect(result.verification?.reasons).toContain('receipt:class-kind-mismatch')
    expect(result.verification?.canExportVerbatim).toBe(true)
    // The roles that WERE checked name their key ids; the owner role that could
    // not be checked names none. An empty owner row with `unavailable` is the
    // honest report, not a missing row.
    const checked = result.trustInputs.filter(row => row.status === 'supplied')
    expect(checked.map(row => row.role)).toEqual(['executor', 'issuer'])
    for (const row of checked) {
      expect(row.keyIds.length).toBe(1)
      expect(row.keyIds[0]).toMatch(/^[0-9a-f]{64}$/u)
    }
    expect(owner?.keyIds).toEqual([])
    store.cli.close()
  }, 30_000)

  it('withholds the original artifact bytes unless the caller asks for them', async () => {
    const store = await settledStore()
    const controller = new AbortController()
    const withheld = await requestBrokerReceiptInspect(store.socketPath, store.receiptSha256, controller.signal)
    expect(withheld.artifact).toBeUndefined()

    const disclosed = await requestBrokerReceiptInspect(store.socketPath, store.receiptSha256, controller.signal, true)
    expect(disclosed.artifact?.bytes).toBeDefined()
    // The saved artifact must be the same bytes the verdict was computed over,
    // and hash to the digest the caller can check it against.
    expect(createHash('sha256').update(disclosed.artifact!.bytes, 'utf8').digest('hex'))
      .toBe(disclosed.artifact!.sha256)
    // Bound to the receipt that was requested, so a returned artifact cannot
    // belong to a different settlement.
    expect(disclosed.artifact!.receiptSha256).toBe(store.receiptSha256)
    store.cli.close()
  }, 30_000)

  it('names the refusal instead of raising for an unknown identifier', async () => {
    const store = await settledStore()
    const controller = new AbortController()
    const result = await requestBrokerReceiptInspect(store.socketPath, 'e'.repeat(64), controller.signal)
    expect(result.refusal).toBe('inspect:receipt-not-found')
    expect(result.settlement.state).toBe('unknown')
    // A refused read still travels with its named limits.
    expect(result.limitations.length).toBeGreaterThan(0)
    store.cli.close()
  }, 30_000)

  it('refuses a malformed identifier before it can reach the filesystem', async () => {
    const store = await settledStore()
    const controller = new AbortController()
    const result = await requestBrokerReceiptInspect(store.socketPath, '../../etc/passwd', controller.signal)
    expect(result.refusal).toBe('inspect:identifier-malformed')
    store.cli.close()
  }, 30_000)

  it('rejects a reply that is not the exact documented document', () => {
    expect(readReceiptInspectReply(null)).toBeNull()
    expect(readReceiptInspectReply({ ok: true })).toBeNull()
    // A refusal must be namespaced: an un-namespaced reason would arrive under
    // the same name as a legacy op's refusal, and a caller cannot tell two
    // outcomes from two spellings of one.
    expect(readReceiptInspectReply({ ok: false, refusal: 'not-found' })).toBeNull()
    expect(readReceiptInspectReply({ ok: false, refusal: 'inspect:receipt-not-found', limitations: [] })?.refusal)
      .toBe('inspect:receipt-not-found')
    // An unknown settlement state must not be silently coerced into a result.
    expect(readReceiptInspectReply({
      ok: true,
      settlement: { state: 'settled', sequence: 1, operation: 'memory.put', key: 'k', chainHash: 'a'.repeat(64) },
      evidence: { v1Available: true, v3Available: true, v3ReadStatus: 'sideways' },
      trustInputs: [],
      limitations: [],
    })).toBeNull()
    // An artifact whose bytes do not carry a checkable digest is refused rather
    // than presented as a saveable original.
    expect(readReceiptInspectReply({
      ok: true,
      settlement: { state: 'settled', sequence: 1, operation: 'memory.put', key: 'k', chainHash: 'a'.repeat(64) },
      evidence: { v1Available: true, v3Available: true, v3ReadStatus: 'ok' },
      trustInputs: [],
      limitations: [],
      artifact: { mediaType: 'application/json', bytes: '{}', sha256: 'nope', receiptSha256: 'a'.repeat(64), publication: null },
    })).toBeNull()
  })
})
