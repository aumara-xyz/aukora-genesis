/** Scripted owner UI decisions over disposable keys; no human-attendance evidence. */
import { generateKeyPairSync } from 'node:crypto'
import { chmodSync, lstatSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { approvalArtifactDigest, createApprovalArtifact, parseApprovalArtifact } from '../aukora/approval/artifact.mjs'
import { renderApprovalArtifact } from '../aukora/approval/render.mjs'
import { BROKER_REFUSE, BROKER_REVIEW_REQUEST, type BrokerReviewRequest } from '../aukora/broker/broker.mjs'
import { ARTIFACT_REVIEW_TIMEOUT_MS, createWebReview, readWebReviewConfig, REVIEW_TIMEOUT_MS } from '../aukora/supervisor/developer-review.mjs'
import { startOwnerReview } from '../aukora/supervisor/owner-review-server.mjs'

type OwnerReview = Awaited<ReturnType<typeof startOwnerReview>>
type WebReview = Awaited<ReturnType<typeof createWebReview>>
type Stage = 'parent' | 'issuer'
interface PendingReview {
  id: string
  stage: Stage
  prompt: string
  expiresAt: number
  reviewId: string
  authorizationDigest: string
  artifactDigest?: string
}
interface OwnerState {
  subject: string
  connection: string
  pending: PendingReview | null
  lastResult: string | null
}
const directories: string[] = []
const owners: OwnerReview[] = []
const reviews: WebReview[] = []

afterEach(async () => {
  await Promise.all(owners.splice(0).map(owner => owner.close()))
  await Promise.all(reviews.splice(0).map(review => review.close()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

async function fixture(appOrigin?: string) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'orv-')))
  directories.push(directory)
  chmodSync(directory, 0o700)
  const key = generateKeyPairSync('ed25519')
  const configPath = join(directory, 'review.json')
  const privateKeyPath = join(directory, 'owner.pem')
  const subject = `aukora:1:${'ab'.repeat(32)}`
  writeFileSync(configPath, JSON.stringify({ domain: 'aukora:web-review-config:v1',
    socketPath: join(directory, 'review.sock'), subject,
    terminalPublicKeyPem: key.publicKey.export({ format: 'pem', type: 'spki' }).toString() }), { mode: 0o600 })
  writeFileSync(privateKeyPath, key.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 })
  const config = readWebReviewConfig(configPath)
  const review = await createWebReview(config, subject)
  reviews.push(review)
  const owner = await startOwnerReview({ config, privateKeyPath, ...(appOrigin === undefined ? {} : { appOrigin }) })
  owners.push(owner)
  return { config, privateKeyPath, review, owner, directory }
}


function request(value: unknown = 'synthetic owner fixture', sequence = 'e'): BrokerReviewRequest {
  const artifact = createApprovalArtifact({ operationArguments: { key: 'owner_review_test', value },
    expiry: Math.floor(Date.now() / 1000) + 120, activationDigest: 'b'.repeat(64),
    occurrenceId: 'c'.repeat(32), rendererId: 'd'.repeat(64) })
  return { type: BROKER_REVIEW_REQUEST, reviewId: sequence.repeat(32), proposalId: 'f'.repeat(32),
    artifact: { ...artifact }, artifactDigest: approvalArtifactDigest(artifact), operationDigest: artifact.operationDigest,
    authorizationDigest: '1'.repeat(64), expiresAt: artifact.expiry }
}

function issuerRequest(parent: BrokerReviewRequest) {
  const challenge = '0123456789abcdef'
  return { challenge, prompt: renderApprovalArtifact(parent.artifact, challenge) }
}

function post(owner: OwnerReview, path: string, value: unknown, sessionToken?: string, headers: Record<string, string | undefined> = {}) {
  const requestHeaders = new Headers({
    Origin: owner.url, 'X-Aukora-Review': '1', 'Content-Type': 'application/json',
    ...(sessionToken === undefined ? {} : { Authorization: `Bearer ${sessionToken}` }),
  })
  for (const [name, header] of Object.entries(headers)) {
    if (header === undefined) requestHeaders.delete(name)
    else requestHeaders.set(name, header)
  }
  return fetch(`${owner.url}${path}`, { method: 'POST', headers: requestHeaders, body: JSON.stringify(value) })
}

async function pair(owner: OwnerReview) {
  const token = new URLSearchParams(new URL(owner.ownerUrl).hash.slice(1)).get('pair')
  expect(token).toMatch(/^[0-9a-f]{64}$/u)
  const response = await post(owner, '/api/pair', { token })
  expect(response.status).toBe(200)
  const result = await response.json() as { sessionToken: string }
  expect(Object.keys(result)).toEqual(['sessionToken'])
  expect(result.sessionToken).toMatch(/^[0-9a-f]{64}$/u)
  expect(response.headers.get('set-cookie')).toBeNull()
  return { sessionToken: result.sessionToken, token }
}

async function state(owner: OwnerReview, sessionToken: string): Promise<OwnerState> {
  const response = await fetch(`${owner.url}/api/state`, { headers: { Authorization: `Bearer ${sessionToken}` } })
  expect(response.status).toBe(200)
  return await response.json() as OwnerState
}

async function pending(owner: OwnerReview, sessionToken: string, stage: Stage): Promise<PendingReview> {
  let value: PendingReview | null = null
  await expect.poll(async () => {
    value = (await state(owner, sessionToken)).pending
    return value?.stage
  }).toBe(stage)
  if (value === null) throw new Error(`Owner fixture did not receive ${stage} review`)
  return value
}

async function decide(owner: OwnerReview, sessionToken: string, value: PendingReview, decision: 'approved' | 'denied') {
  const response = await post(owner, '/api/decision', { id: value.id, decision }, sessionToken)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true })
}

/** Keep the browser inside the absence window so the client forwards a request to the popup. */
function watchingBrowser(owner: OwnerReview, sessionToken: string) {
  return setInterval(() => {
    void fetch(`${owner.url}/api/state`, { headers: { Authorization: `Bearer ${sessionToken}` } }).catch(() => {})
  }, 500)
}

async function approveParent(f: Awaited<ReturnType<typeof fixture>>, sessionToken: string, input: BrokerReviewRequest) {
  const result = f.review.review(input, new AbortController().signal)
  const prompt = await pending(f.owner, sessionToken, 'parent')
  await decide(f.owner, sessionToken, prompt, 'approved')
  expect(await result).toBe('approved')
  return prompt
}

// The owner transport requires POSIX file modes and a private Unix-domain socket.
describe.skipIf(process.platform === 'win32')('owner browser with scripted fixture decisions', () => {
  it('allows only the configured chat origin and exposes no separate HTML page', async () => {
    const appOrigin = 'http://127.0.0.1:5173'
    const f = await fixture(appOrigin)
    expect(new URL(f.owner.ownerUrl).origin).toBe(appOrigin)
    const preflight = await fetch(`${f.owner.url}/api/decision`, { method: 'OPTIONS',
      headers: { Origin: appOrigin, 'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type,x-aukora-review' } })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe(appOrigin)
    expect(preflight.headers.get('access-control-allow-credentials')).toBeNull()
    const token = new URLSearchParams(new URL(f.owner.ownerUrl).hash.slice(1)).get('pair')
    expect((await post(f.owner, '/api/pair', { token })).status).toBe(403)
    const pair = await post(f.owner, '/api/pair', { token }, undefined, { Origin: appOrigin })
    expect(pair.status).toBe(200)
    expect(pair.headers.get('access-control-allow-origin')).toBe(appOrigin)
    const rejected = await fetch(`${f.owner.url}/api/state`, { headers: { Origin: 'http://127.0.0.1:5174' } })
    expect(rejected.status).toBe(403)
    expect(rejected.headers.get('access-control-allow-origin')).toBeNull()
    const root = await fetch(f.owner.url)
    expect(root.headers.get('content-type')).toBe('application/json; charset=utf-8')
  })
  it('pairs once and keeps pending operations private to the authenticated session', async () => {
    const f = await fixture()
    const before = await fetch(`${f.owner.url}/api/state`)
    expect(before.status).toBe(401)
    expect(await before.json()).toEqual({ error: 'owner-session-required' })
    const { sessionToken, token } = await pair(f.owner)
    const again = await post(f.owner, '/api/pair', { token })
    expect(again.status).toBe(401)
    expect(await again.json()).toEqual({ error: 'pairing-unavailable' })
    expect(await state(f.owner, sessionToken)).toEqual({ subject: f.config.subject,
      connection: 'connected', pending: null, lastResult: null })
    const cookieHeaders = { Cookie: `aukora-owner-${new URL(f.owner.url).port}=${sessionToken}` }
    const cookieState = await fetch(`${f.owner.url}/api/state`, { headers: cookieHeaders })
    expect(cookieState.status).toBe(401)
    expect(await cookieState.json()).toEqual({ error: 'owner-session-required' })

    const result = f.review.review(request(), new AbortController().signal)
    const current = await pending(f.owner, sessionToken, 'parent')
    const anonymous = await post(f.owner, '/api/decision', { id: current.id, decision: 'approved' })
    expect(anonymous.status).toBe(401)
    expect(await anonymous.json()).toEqual({ error: 'owner-session-required' })
    const cookieDecision = await post(f.owner, '/api/decision', { id: current.id, decision: 'approved' }, undefined, cookieHeaders)
    expect(cookieDecision.status).toBe(401)
    expect(await cookieDecision.json()).toEqual({ error: 'owner-session-required' })
    expect((await state(f.owner, sessionToken)).pending).toEqual(current)
    await decide(f.owner, sessionToken, current, 'denied')
    expect(await result).toBe('denied')
  })

  it('preserves the owner key mismatch error when startup cannot authenticate', async () => {
    const f = await fixture()
    await f.owner.close()
    const privateKeyPath = join(f.directory, 'different-owner.pem')
    const key = generateKeyPairSync('ed25519')
    writeFileSync(privateKeyPath, key.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 })
    await expect(startOwnerReview({ config: f.config, privateKeyPath })).rejects.toThrow('aukora:web-review:terminal-key-mismatch')
    expect(lstatSync(f.config.socketPath).isSocket()).toBe(true)
  })

  it.each([
    ['a different origin', { Origin: 'https://owner-fixture.invalid' }],
    ['an absent origin', { Origin: undefined }],
    ['an absent review header', { 'X-Aukora-Review': undefined }],
    ['a different content type', { 'Content-Type': 'text/plain' }],
  ] as const)('refuses pairing and decisions from %s', async (_name, headers) => {
    const f = await fixture()
    const token = new URLSearchParams(new URL(f.owner.ownerUrl).hash.slice(1)).get('pair')
    const refusedPair = await post(f.owner, '/api/pair', { token }, undefined, headers)
    expect(refusedPair.status).toBe(403)
    expect(await refusedPair.json()).toEqual({ error: 'origin-refused' })
    const { sessionToken } = await pair(f.owner)
    const result = f.review.review(request(), new AbortController().signal)
    const current = await pending(f.owner, sessionToken, 'parent')
    const refusedDecision = await post(f.owner, '/api/decision', { id: current.id, decision: 'approved' }, sessionToken, headers)
    expect(refusedDecision.status).toBe(403)
    expect(await refusedDecision.json()).toEqual({ error: 'origin-refused' })
    expect((await state(f.owner, sessionToken)).pending).toEqual(current)
    await decide(f.owner, sessionToken, current, 'denied')
    expect(await result).toBe('denied')
  })

  it('renders the full literal operation and requires distinct parent and issuer decisions for its digest', async () => {
    const f = await fixture()
    const { sessionToken } = await pair(f.owner)
    const literal = `<section title="fixture">${'literal & owner text '.repeat(80)}</section>`
    const input = request({ literal, nested: ['first', 'last'] })
    expect(await f.review.issuerApproval(issuerRequest(input), new AbortController().signal)).toBe('unavailable')
    const parent = await approveParent(f, sessionToken, input)
    expect(parent).toMatchObject({ authorizationDigest: input.authorizationDigest,
      artifactDigest: input.artifactDigest, reviewId: input.reviewId })
    const challenge = /yes ([0-9a-f]{16})/u.exec(parent.prompt)?.[1]
    expect(challenge).toBeDefined()
    expect(parent.prompt).toBe(renderApprovalArtifact(input.artifact, challenge!))
    for (const line of parseApprovalArtifact(input.artifact).semanticProjection) expect(parent.prompt).toContain(`  | ${line}`)
    expect(parent.prompt).toContain('literal & owner text '.repeat(80))
    expect(await state(f.owner, sessionToken)).toMatchObject({ pending: null,
      lastResult: 'Parent approval sent. Separate issuer confirmation is still required.' })

    const issuerInput = issuerRequest(input)
    const result = f.review.issuerApproval(issuerInput, new AbortController().signal)
    const issuer = await pending(f.owner, sessionToken, 'issuer')
    expect(issuer.id).not.toBe(parent.id)
    expect(issuer.reviewId).not.toBe(parent.reviewId)
    expect(issuer.authorizationDigest).toBe(input.authorizationDigest)
    expect(issuer.prompt).toBe(issuerInput.prompt)
    expect(issuer).not.toHaveProperty('artifactDigest')
    const stale = await post(f.owner, '/api/decision', { id: parent.id, decision: 'approved' }, sessionToken)
    expect(stale.status).toBe(409)
    expect(await stale.json()).toEqual({ error: 'request-no-longer-pending' })
    expect((await state(f.owner, sessionToken)).pending).toEqual(issuer)
    await decide(f.owner, sessionToken, issuer, 'approved')
    expect(await result).toBe('approved')
    expect(await state(f.owner, sessionToken)).toMatchObject({ pending: null,
      lastResult: 'Issuer approval sent. Settlement and receipt verification are not yet confirmed.' })
    const duplicate = await post(f.owner, '/api/decision', { id: issuer.id, decision: 'approved' }, sessionToken)
    expect(duplicate.status).toBe(409)
    expect(await duplicate.json()).toEqual({ error: 'request-no-longer-pending' })
    expect(await f.review.issuerApproval(issuerInput, new AbortController().signal)).toBe('unavailable')
  })

  it.each(['parent', 'issuer'] as const)('returns an explicit %s denial without retaining an issuer authorization', async (stage) => {
    const f = await fixture()
    const { sessionToken } = await pair(f.owner)
    const input = request()
    if (stage === 'issuer') await approveParent(f, sessionToken, input)
    const result = stage === 'parent' ? f.review.review(input, new AbortController().signal)
      : f.review.issuerApproval(issuerRequest(input), new AbortController().signal)
    const current = await pending(f.owner, sessionToken, stage)
    await decide(f.owner, sessionToken, current, 'denied')
    expect(await result).toBe('denied')
    expect(await state(f.owner, sessionToken)).toMatchObject({ pending: null, lastResult: 'Operation denied.' })
    expect(await f.review.issuerApproval(issuerRequest(input), new AbortController().signal)).toBe('unavailable')
  })

  it.each(['parent', 'issuer'] as const)('invalidates a cancelled %s request before accepting another click', async (stage) => {
    const f = await fixture()
    const { sessionToken } = await pair(f.owner)
    const input = request()
    if (stage === 'issuer') await approveParent(f, sessionToken, input)
    const abort = new AbortController()
    const result = stage === 'parent' ? f.review.review(input, abort.signal)
      : f.review.issuerApproval(issuerRequest(input), abort.signal)
    const refused = stage === 'parent' ? expect(result).rejects.toThrow(BROKER_REFUSE.STOPPING)
      : expect(result).resolves.toBe('unavailable')
    const current = await pending(f.owner, sessionToken, stage)
    abort.abort()
    await refused
    await expect.poll(async () => (await state(f.owner, sessionToken)).pending).toBeNull()
    const late = await post(f.owner, '/api/decision', { id: current.id, decision: 'approved' }, sessionToken)
    expect(late.status).toBe(409)
    expect(await late.json()).toEqual({ error: 'request-no-longer-pending' })
    expect(await f.review.issuerApproval(issuerRequest(input), new AbortController().signal)).toBe('unavailable')
  })

  it('keeps the review service alive when the owner service closes and accepts a fresh owner', async () => {
    const f = await fixture()
    const { sessionToken } = await pair(f.owner)
    const input = request()
    await approveParent(f, sessionToken, input)
    await f.owner.close()
    expect(lstatSync(f.config.socketPath).isSocket()).toBe(true)
    expect(await f.review.issuerApproval(issuerRequest(input), new AbortController().signal)).toBe('unavailable')

    const owner = await startOwnerReview({ config: f.config, privateKeyPath: f.privateKeyPath })
    owners.push(owner)
    const replacement = await pair(owner)
    expect(await state(owner, replacement.sessionToken)).toMatchObject({ connection: 'connected', pending: null })
    expect(await f.review.issuerApproval(issuerRequest(input), new AbortController().signal)).toBe('unavailable')
    const result = f.review.review(request('fresh owner fixture', 'a'), new AbortController().signal)
    await decide(owner, replacement.sessionToken, await pending(owner, replacement.sessionToken, 'parent'), 'denied')
    expect(await result).toBe('denied')
  })

  it('re-attaches the same transport on its own after a request expires unanswered', async () => {
    const f = await fixture()
    const { sessionToken } = await pair(f.owner)
    const watching = watchingBrowser(f.owner, sessionToken)
    try {
      const result = f.review.review(request('expiry reconnect fixture', 'a'), new AbortController().signal)
        .catch((error: unknown) => error)
      const displayed = await pending(f.owner, sessionToken, 'parent')
      expect(await result).not.toBe('approved')
      await expect.poll(async () => (await state(f.owner, sessionToken)).connection,
        { timeout: 20_000, interval: 250 }).toBe('connected')
      const late = await post(f.owner, '/api/decision', { id: displayed.id, decision: 'approved' }, sessionToken)
      expect(late.status).toBe(409)
      expect(await late.json()).toEqual({ error: 'request-no-longer-pending' })
    } finally { clearInterval(watching) }
    // Waits out a real artifact-stage expiry, which this change raised from 20 s to 30 s,
    // then polls for re-attachment for up to 20 s. Sixty left ten seconds for fixture setup.
  }, 90_000)

  it('re-attaches after a cancelled request and still refuses that request', async () => {
    const f = await fixture()
    const { sessionToken } = await pair(f.owner)
    const watching = watchingBrowser(f.owner, sessionToken)
    try {
      const controller = new AbortController()
      const result = f.review.review(request('cancelled reconnect fixture', 'b'), controller.signal)
        .catch((error: unknown) => error)
      const displayed = await pending(f.owner, sessionToken, 'parent')
      controller.abort()
      expect(await result).not.toBe('approved')
      await expect.poll(async () => (await state(f.owner, sessionToken)).connection,
        { timeout: 20_000, interval: 250 }).toBe('connected')
      const late = await post(f.owner, '/api/decision', { id: displayed.id, decision: 'approved' }, sessionToken)
      expect(late.status).toBe(409)
    } finally { clearInterval(watching) }
  }, 60_000)

  it('re-attaches to a restarted transport and reaches the paired browser with a fresh request', async () => {
    const f = await fixture()
    const { sessionToken } = await pair(f.owner)
    await f.review.close()
    rmSync(f.config.socketPath, { force: true })
    const revived = await createWebReview(f.config, f.config.subject)
    reviews.push(revived)
    await expect.poll(async () => (await state(f.owner, sessionToken)).connection,
      { timeout: 20_000, interval: 250 }).toBe('connected')
    const watching = watchingBrowser(f.owner, sessionToken)
    try {
      const result = revived.review(request('restart fixture', 'd'), new AbortController().signal)
      const view = await pending(f.owner, sessionToken, 'parent')
      await decide(f.owner, sessionToken, view, 'denied')
      expect(await result).toBe('denied')
    } finally { clearInterval(watching) }
  }, 60_000)

  it('stops after a bounded attempt budget when the transport refuses authentication', async () => {
    const f = await fixture()
    const { sessionToken } = await pair(f.owner)
    await f.review.close()
    rmSync(f.config.socketPath, { force: true })
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'orv-key-')))
    directories.push(directory)
    chmodSync(directory, 0o700)
    const otherKey = generateKeyPairSync('ed25519')
    const otherConfigPath = join(directory, 'review.json')
    writeFileSync(otherConfigPath, JSON.stringify({ domain: 'aukora:web-review-config:v1',
      socketPath: f.config.socketPath, subject: f.config.subject,
      terminalPublicKeyPem: otherKey.publicKey.export({ format: 'pem', type: 'spki' }).toString() }), { mode: 0o600 })
    const otherConfig = readWebReviewConfig(otherConfigPath)
    const revived = await createWebReview(otherConfig, otherConfig.subject)
    reviews.push(revived)
    await expect.poll(async () => (await state(f.owner, sessionToken)).connection,
      { timeout: 10_000, interval: 100 }).toBe('connecting')
    await expect.poll(async () => (await state(f.owner, sessionToken)).connection,
      { timeout: 25_000, interval: 250 }).toBe('disconnected')
  }, 60_000)

  it('cancels pending reconnection work when the owner service closes', async () => {
    const f = await fixture()
    const { sessionToken } = await pair(f.owner)
    await f.review.close()
    await expect.poll(async () => (await state(f.owner, sessionToken)).connection,
      { timeout: 10_000, interval: 100 }).toBe('connecting')
    await expect(f.owner.close()).resolves.toBeUndefined()
    await expect(fetch(`${f.owner.url}/api/state`, { headers: { Authorization: `Bearer ${sessionToken}` } }))
      .rejects.toThrow()
  }, 30_000)

  it('resumes automatic recovery after an authenticated manual reconnect fails mid-backoff', async () => {
    // The manual route clears the automatic attempt budget. Clearing it must not
    // also end recovery: a transport that returns after a failed manual attempt has
    // to be re-attached without a second operator action. The owner UI enables its
    // Reconnect button while the server is still in backoff, because the client maps
    // a server 'connecting' to its own 'unavailable', so this is the ordinary path.
    const f = await fixture()
    const { sessionToken } = await pair(f.owner)

    // Automatic recovery is scheduled: drop the transport and observe the backoff.
    await f.review.close()
    rmSync(f.config.socketPath, { force: true })
    await expect.poll(async () => (await state(f.owner, sessionToken)).connection,
      { timeout: 10_000, interval: 50 }).toBe('connecting')

    // An authenticated manual reconnect arrives while the transport is unavailable,
    // and fails. Possession of the session token is what authenticates it.
    const manual = await post(f.owner, '/api/reconnect', {}, sessionToken)
    expect(manual.status).toBe(503)
    expect(await manual.json()).toEqual({ error: 'connection-unavailable' })

    // The transport returns, with no further manual call.
    const revived = await createWebReview(f.config, f.config.subject)
    reviews.push(revived)
    await expect.poll(async () => (await state(f.owner, sessionToken)).connection,
      { timeout: 20_000, interval: 100 }).toBe('connected')

    // Recovery is genuine, not a stale label: a fresh request reaches the browser.
    const stop = watchingBrowser(f.owner, sessionToken)
    try {
      const input = request()
      const decided = revived.review(input, new AbortController().signal)
      const view = await pending(f.owner, sessionToken, 'parent')
      await decide(f.owner, sessionToken, view, 'approved')
      expect(await decided).toBe('approved')
    } finally { clearInterval(stop) }
  }, 90_000)
})

describe('stage view windows', () => {
  it('shows each stage the window its transport leg actually enforces', async () => {
    const f = await fixture()
    const { sessionToken } = await pair(f.owner)
    const input = request()
    const parentResult = f.review.review(input, new AbortController().signal)
    const parent = await pending(f.owner, sessionToken, 'parent')
    const parentRemaining = parent.expiresAt - Date.now()
    expect(parentRemaining).toBeGreaterThan(REVIEW_TIMEOUT_MS)
    expect(parentRemaining).toBeLessThanOrEqual(ARTIFACT_REVIEW_TIMEOUT_MS)
    await decide(f.owner, sessionToken, parent, 'approved')
    expect(await parentResult).toBe('approved')
    const issuerInput = issuerRequest(input)
    const issuerResult = f.review.issuerApproval(issuerInput, new AbortController().signal)
    const issuer = await pending(f.owner, sessionToken, 'issuer')
    expect(issuer.expiresAt - Date.now()).toBeLessThanOrEqual(REVIEW_TIMEOUT_MS)
    await decide(f.owner, sessionToken, issuer, 'approved')
    expect(await issuerResult).toBe('approved')
  })

  it('refuses a view window wider than the transport leg that would cut it short', async () => {
    const f = await fixture()
    for (const invalid of [{ reviewWindowMs: ARTIFACT_REVIEW_TIMEOUT_MS + 1 }, { issuerWindowMs: REVIEW_TIMEOUT_MS + 1 },
      { reviewWindowMs: 0 }, { issuerWindowMs: 1.5 }]) {
      await expect(startOwnerReview({ config: f.config, privateKeyPath: f.privateKeyPath, ...invalid }))
        .rejects.toThrow('aukora:owner-review:review-window-invalid')
    }
    // The accepting path is the fixture's own default owner, still holding the one transport
    // channel: a second server on this config would take it, which is why none is started here.
    expect((await state(f.owner, (await pair(f.owner)).sessionToken)).connection).toBe('connected')
  })
})
