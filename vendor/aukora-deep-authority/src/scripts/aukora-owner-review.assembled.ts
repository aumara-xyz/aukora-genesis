/** Scripted owner panel over real disposable guest, broker, and issuer processes. */
import { createHash, generateKeyPairSync } from 'node:crypto'
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseApprovalArtifact } from '../aukora/approval/artifact.mjs'
import type { BrokerReviewRequest } from '../aukora/broker/broker.mjs'
import { observe } from '../aukora/broker/effect.mjs'
import { effectBody } from '../aukora/broker/operation.mjs'
import { readReceipt, verifyReceipt } from '../aukora/broker/receipt.mjs'
import { payloadDigest, receiptKeyIdForPublicKey } from '../aukora/host-dsh/src/grant.mjs'
import { launchDeveloperAssembly } from '../aukora/supervisor/developer-launch.mjs'
import { createWebReview, readWebReviewConfig, WEB_REVIEW_RENDERER_ID } from '../aukora/supervisor/developer-review.mjs'
import { startOwnerReview } from '../aukora/supervisor/owner-review-server.mjs'

type OwnerReview = Awaited<ReturnType<typeof startOwnerReview>>
interface PendingReview { id: string; stage: 'parent' | 'issuer'; prompt: string; authorizationDigest: string }
const directories: string[] = []
const handles: Array<{ close(): Promise<void> }> = []

afterEach(async () => {
  for (const handle of handles.splice(0).reverse()) await handle.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

async function panel(owner: OwnerReview) {
  const call = async (path: string, body?: unknown, sessionToken?: string) => {
    const response = await fetch(`${owner.url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Origin: owner.url, 'X-Aukora-Review': '1', 'Content-Type': 'application/json',
        ...(sessionToken === undefined ? {} : { Authorization: `Bearer ${sessionToken}` }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    expect(response.status).toBe(200)
    return response.json() as Promise<Record<string, unknown>>
  }
  const token = new URLSearchParams(new URL(owner.ownerUrl).hash.slice(1)).get('pair')
  const paired = await call('/api/pair', { token })
  if (typeof paired.sessionToken !== 'string') throw new Error('Fixture pairing omitted its session token')
  const sessionToken = paired.sessionToken
  const current = async () => (await call('/api/state', undefined, sessionToken)).pending as PendingReview | null
  return {
    async pending(stage: PendingReview['stage']): Promise<PendingReview> {
      await expect.poll(async () => (await current())?.stage).toBe(stage)
      const request = await current()
      if (request?.stage !== stage) throw new Error('Fixture did not retain its pending review')
      return request
    },
    async decide(current: PendingReview, decision: 'approved' | 'denied') {
      expect(await call('/api/decision', { id: current.id, decision }, sessionToken)).toEqual({ ok: true })
    },
  }
}

// This verifies same-UID transport and settlement, not human attendance or custody.
describe.skipIf(process.platform === 'win32')('owner browser real assembly', () => {
  it('settles a real broker proposal only after both panel decisions and verifies the signed receipt against the exact object', async () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'orp-')))
    directories.push(directory)
    chmodSync(directory, 0o700)
    const ownerKeys = generateKeyPairSync('ed25519')
    const configPath = join(directory, 'review.json')
    const privateKeyPath = join(directory, 'owner.pem')
    const subject = `aukora:1:${'ab'.repeat(32)}`
    writeFileSync(configPath, JSON.stringify({ domain: 'aukora:web-review-config:v1', subject,
      socketPath: join(directory, 'review.sock'),
      terminalPublicKeyPem: ownerKeys.publicKey.export({ format: 'pem', type: 'spki' }).toString() }), { mode: 0o600 })
    writeFileSync(privateKeyPath, ownerKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
    const config = readWebReviewConfig(configPath)
    const review = await createWebReview(config, subject)
    handles.push(review)
    const owner = await startOwnerReview({ config, privateKeyPath })
    handles.push(owner)
    const issuerKeys = generateKeyPairSync('ed25519')
    const rootPrivateKeyFile = join(directory, 'issuer-private.pem')
    const rootPublicKeyFile = join(directory, 'issuer-public.pem')
    writeFileSync(rootPrivateKeyFile, issuerKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
    writeFileSync(rootPublicKeyFile, issuerKeys.publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o600 })
    const brokerReviews: BrokerReviewRequest[] = []
    const assembly = await launchDeveloperAssembly({ runtimeDir: join(directory, 'runtime'),
      rootPrivateKeyFile, rootPublicKeyFile, rendererId: WEB_REVIEW_RENDERER_ID,
      review: (input, signal) => {
        const reviewRequest = input as BrokerReviewRequest
        brokerReviews.push(reviewRequest)
        return review.review(reviewRequest, signal)
      },
      issuerApproval: (input, signal) => review.issuerApproval(input, signal),
      issuerStderr: () => {},
    })
    handles.push(assembly)
    expect(new Set([assembly.broker.pid, assembly.issuer.pid, assembly.guest.pid]).size).toBe(3)
    // The fixture's authority state supplies the pin before any operation response exists.
    const { publicPem } = JSON.parse(readFileSync(join(assembly.paths.stateDir, 'keys', 'broker.json'), 'utf8')) as { publicPem: string }
    expect(assembly.activationStatement).toMatchObject({ brokerId: receiptKeyIdForPublicKey(publicPem) })
    const ui = await panel(owner)
    const args = { key: 'owner.panel.settlement', value: { literal: '<section>fixture & exact bytes</section>', count: 1 } }
    const emptyEffect = () => {
      for (const path of ['memory', 'aura.jsonl', 'receipts']) expect(existsSync(join(assembly.paths.stateDir, path))).toBe(false)
    }
    const refused = assembly.executeMemoryPut(args)
    const deniedParent = await ui.pending('parent')
    emptyEffect()
    await ui.decide(deniedParent, 'denied')
    expect(await refused).toMatchObject({ outcome: 'REFUSED' })
    emptyEffect()

    const execution = assembly.executeMemoryPut(args)
    const parent = await ui.pending('parent')
    const reviewed = brokerReviews.at(-1)
    if (reviewed === undefined) throw new Error('Broker fixture did not request parent review')
    const artifact = parseApprovalArtifact(reviewed.artifact)
    expect(artifact.operationArguments).toEqual(args)
    expect(artifact.activationDigest).toBe(assembly.activationDigest)
    expect(parent.authorizationDigest).toBe(reviewed.authorizationDigest)
    emptyEffect()
    await ui.decide(parent, 'approved')
    const issuer = await ui.pending('issuer')
    expect(issuer.id).not.toBe(parent.id)
    expect(issuer.authorizationDigest).toBe(parent.authorizationDigest)
    for (const line of artifact.semanticProjection) expect(issuer.prompt).toContain(`  | ${line}`)
    emptyEffect()
    await ui.decide(issuer, 'approved')
    const settled = await execution
    expect(settled.outcome).toBe('SETTLED')
    expect(settled.result.isError).not.toBe(true)
    const block = settled.result.content[0]
    if (block?.type !== 'text' || typeof block.text !== 'string') throw new Error('Settled fixture omitted its result')
    const result = JSON.parse(block.text) as { state: string; receipt: Record<string, unknown> }
    expect(result.state).toBe('SETTLED')
    const expectedBody = effectBody(args)
    const contentSha256 = createHash('sha256').update(expectedBody).digest('hex')
    const objectPath = join(assembly.paths.stateDir, 'memory', 'objects', `${contentSha256}.json`)
    expect(result.receipt).toMatchObject({ requestDigest: payloadDigest('memory.put', args),
      definitionId: artifact.definitionId, path: objectPath, contentSha256,
      bytes: Buffer.byteLength(expectedBody), sequence: 1 })
    expect(readFileSync(objectPath, 'utf8')).toBe(expectedBody)
    expect(verifyReceipt({ receipt: result.receipt, brokerPublicKeyPem: publicPem, observe })).toEqual({ ok: true })
    const receipts = readdirSync(join(assembly.paths.stateDir, 'receipts'))
    expect(receipts).toHaveLength(1)
    const receiptFile = receipts[0]
    if (receiptFile === undefined) throw new Error('Broker fixture did not retain its receipt')
    expect(readReceipt({ stateDir: assembly.paths.stateDir, receiptSha256: receiptFile.replace(/\.json$/u, '') })).toEqual(result.receipt)
    expect(brokerReviews).toHaveLength(2)
  }, 30_000)
})
