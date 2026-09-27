/**
 * Real HTTP coverage for the receipt viewer.
 *
 * The viewer is driven over its own socket against a REAL broker holding a REAL
 * settlement, because a stubbed memory route would let this test agree with its
 * own idea of what an inspection returns, which is the mistake the viewer exists
 * to prevent.
 *
 * The assertions pin the two properties that make the page honest: the three
 * facts stay in separate fields, and a request that is not a well-formed
 * same-origin inspection is refused BEFORE the broker is reached.
 */
import { createConnection } from 'node:net'
import { createHash, generateKeyPairSync, sign as edSign } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import { provisionBrokerIdentity, spawnBroker } from '@aukora/core/broker/broker.mjs'
import { MEMORY_PUT, definitionDigest } from '@aukora/core/broker/effect-definition.mjs'
import { payloadDigest, newNonce, grantPreimage } from '@aukora/core/host-dsh/src/grant.mjs'
import { buildOperation, operationDigest } from '@aukora/core/broker/operation.mjs'
import { requestBrokerReceiptInspect } from '@deepseek-ai/dsh-aukora-memory/src/proposal-client.ts'
import { artifactDigest, isExactReceiptDigest, RECEIPT_VIEW_PATH } from '@deepseek-ai/dsh-aukora-memory/src/receipt-view.ts'

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

/**
 * A viewer-shaped route host over a real HTTP server on an ephemeral port.
 *
 * The composition under test is the viewer's own request handling; the carrier
 * is the same node:http surface the guest's web server exposes.
 */
async function viewerHost() {
  const { createServer } = await import('node:http')
  const routes = new Map<string, (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void | Promise<void>>()
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    const handler = routes.get(path)
    if (handler === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    void handler(req, res)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  return {
    host: {
      register: (route: { kind: 'exact'; path: string; handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void | Promise<void> }) => {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

/** One disposable store holding one real settlement, and the viewer on top of it. */
async function viewerOverSettlement() {
  const root = mkdtempSync(join(tmpdir(), 'aukora-receipt-view-'))
  roots.push(root)
  const stateDir = join(root, 'state')
  mkdirSync(stateDir, { mode: 0o700 })
  const socketPath = join(root, 'broker.sock')
  const receiptKeyId = provisionBrokerIdentity(stateDir).receiptKeyId
  const rootPair = generateKeyPairSync('ed25519')
  const rootPem = rootPair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  children.push(await spawnBroker({ socketPath, stateDir, rootPublicKeyPem: rootPem }))

  const socket = createConnection(socketPath)
  await once(socket, 'connect')
  const settleFrame = (() => {
    const args = { key: 'receipt-view-subject', value: { text: 'viewed' } }
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
    return {
      id: 1,
      op: 'memory.put',
      toolName: MEMORY_PUT,
      arguments: args,
      grant: { ...claims, signature: edSign(null, grantPreimage(claims), rootPair.privateKey).toString('base64') },
    }
  })()
  socket.write(`${JSON.stringify(settleFrame)}\n`)
  await new Promise<void>(resolve => socket.once('data', () => { resolve() }))
  socket.destroy()

  const receiptSha256 = readFileSync(join(stateDir, 'aura.jsonl'), 'utf8')
    .trim().split('\n')
    .map(line => JSON.parse(line) as Record<string, unknown>)
    .find(entry => entry.sequence === 1)?.receiptSha256 as string
  expect(isExactReceiptDigest(receiptSha256)).toBe(true)

  const viewer = await viewerHost()
  // The viewer reads the memory route from the Cordis context; this test supplies
  // the same service shape with the same real broker socket behind it.
  const { mountReceiptView } = await import('@deepseek-ai/dsh-aukora-memory/src/receipt-view.ts')
  const memoryRoute = {
    inspectReceipt: (
      digest: string,
      signal: AbortSignal,
      includeArtifact: boolean = false,
    ) => requestBrokerReceiptInspect(socketPath, digest, signal, includeArtifact),
  }
  mountReceiptView(
    {
      effect: (fn: () => () => void) => fn(),
      get: (name: string) => name === 'aukora.memory' ? memoryRoute : undefined,
    } as unknown as Context,
    viewer.host,
  )
  return { ...viewer, receiptSha256, stateDir }
}

/** POST one viewer request the way the page does. */
function viewerPost(origin: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-aukora-viewer': '1', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('receipt viewer route', () => {
  it('serves a page that carries no operation data', async () => {
    const viewer = await viewerOverSettlement()
    const response = await fetch(`${viewer.origin}${RECEIPT_VIEW_PATH}`)
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
    // The page fetches its own data: no receipt digest, path or value is baked
    // into the markup, so nothing stored can be rendered as markup.
    expect(html).not.toContain(viewer.receiptSha256)
    expect(html).toContain('Read and save the original export')
    await viewer.close()
  }, 30_000)

  it('reports settlement, verdict and attribution as separate values', async () => {
    const viewer = await viewerOverSettlement()
    const response = await viewerPost(viewer.origin, `${RECEIPT_VIEW_PATH}/inspect`, { receiptSha256: viewer.receiptSha256 })
    expect(response.status).toBe(200)
    const payload = await response.json() as Record<string, never>
    const body = payload as unknown as {
      settlement: { state: string; sequence: number; operation: string; subject: string }
      evidence: { v1Available: boolean; v3ReadStatus: string }
      verification: { verdict: string; approvalClass: string; reasons: string[] }
      trustInputs: Array<{ role: string; status: string }>
    }
    expect(body.settlement.state).toBe('settled')
    expect(body.settlement.sequence).toBe(1)
    expect(body.settlement.subject).toBe('receipt-view-subject')
    expect(body.evidence.v1Available).toBe(true)
    expect(body.evidence.v3ReadStatus).toBe('ok')
    expect(body.verification.verdict).toBe('NON-CONFORMING')
    expect(body.verification.approvalClass).toBe('unattributed')
    expect(body.trustInputs.find(row => row.role === 'owner')?.status).toBe('unavailable')
    await viewer.close()
  }, 30_000)

  it('withholds the export until a request states that purpose', async () => {
    const viewer = await viewerOverSettlement()
    const read = await viewerPost(viewer.origin, `${RECEIPT_VIEW_PATH}/inspect`, { receiptSha256: viewer.receiptSha256 })
    const withheld = await read.json() as Record<string, unknown>
    expect(withheld.artifact).toBeUndefined()

    const disclosed = await viewerPost(viewer.origin, `${RECEIPT_VIEW_PATH}/artifact`, { receiptSha256: viewer.receiptSha256 })
    const body = await disclosed.json() as { artifact: { bytes: string; sha256: string; receiptSha256: string } }
    // The bytes a reader would save hash to the digest the response states, and
    // are bound to the receipt that was asked for.
    expect(artifactDigest(body.artifact.bytes)).toBe(body.artifact.sha256)
    expect(createHash('sha256').update(body.artifact.bytes, 'utf8').digest('hex')).toBe(body.artifact.sha256)
    expect(body.artifact.receiptSha256).toBe(viewer.receiptSha256)
    await viewer.close()
  }, 30_000)

  it('refuses a malformed request before the broker is reached', async () => {
    const viewer = await viewerOverSettlement()
    const wrongMethod = await fetch(`${viewer.origin}${RECEIPT_VIEW_PATH}/inspect`)
    expect(wrongMethod.status).toBe(405)
    expect((await wrongMethod.json() as { refusal: string }).refusal).toBe('viewer:method-not-allowed')

    const noHeader = await viewerPost(viewer.origin, `${RECEIPT_VIEW_PATH}/inspect`, { receiptSha256: viewer.receiptSha256 }, { 'x-aukora-viewer': '' })
    expect(noHeader.status).toBe(403)
    expect((await noHeader.json() as { refusal: string }).refusal).toBe('viewer:header-required')

    const crossOrigin = await viewerPost(viewer.origin, `${RECEIPT_VIEW_PATH}/inspect`, { receiptSha256: viewer.receiptSha256 }, { origin: 'http://evil.example' })
    expect(crossOrigin.status).toBe(403)
    expect((await crossOrigin.json() as { refusal: string }).refusal).toBe('viewer:origin-not-accepted')

    // A crafted identifier must not reach the broker, even though the request is
    // otherwise well formed.
    const traversal = await viewerPost(viewer.origin, `${RECEIPT_VIEW_PATH}/inspect`, { receiptSha256: '../../etc/passwd' })
    expect(traversal.status).toBe(400)
    expect((await traversal.json() as { refusal: string }).refusal).toBe('viewer:digest-malformed')

    const notJson = await viewerPost(viewer.origin, `${RECEIPT_VIEW_PATH}/inspect`, 'not json')
    expect(notJson.status).toBe(400)
    expect((await notJson.json() as { refusal: string }).refusal).toBe('viewer:body-unreadable')

    const oversized = await viewerPost(viewer.origin, `${RECEIPT_VIEW_PATH}/inspect`, { receiptSha256: 'a'.repeat(8192) })
    expect([400, 413]).toContain(oversized.status)
    await viewer.close()
  }, 30_000)

  it('names a refusal for an unknown identifier instead of reporting a settlement', async () => {
    const viewer = await viewerOverSettlement()
    const response = await viewerPost(viewer.origin, `${RECEIPT_VIEW_PATH}/inspect`, { receiptSha256: 'e'.repeat(64) })
    expect(response.status).toBe(200)
    const body = await response.json() as { refusal: string; settlement: { state: string } }
    // The refusal is a result: the read succeeded and this store records no such
    // receipt. It must not be reported as an unavailable service.
    expect(body.refusal).toBe('inspect:receipt-not-found')
    expect(body.settlement.state).toBe('unknown')
    await viewer.close()
  }, 30_000)
})
