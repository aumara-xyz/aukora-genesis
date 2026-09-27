/**
 * The broker-to-issuer digest hop, and the v4 grant family it makes possible.
 *
 * `docs/specs/BRICK-0-CONTRACT.ts` freezes `HopPayload` to one field and states
 * that `GrantIssuer.awaitGrant(payload)` returns a complete `CapabilityGrant`.
 * Those two sentences cannot both hold for grant v3: `grantPreimage` signs
 * seven claims and `mintGrant` needs raw arguments, an expiry, and a receipt-key
 * identity to build them, none of which survive a SHA-256. The v4 family
 * resolves it by moving what the root signs — the digest of the claims preimage
 * rather than the preimage — so the issuer authorizes a value it cannot invert
 * and the broker re-derives that value from the claims it kept.
 *
 * These rows cover the protocol and the issuer's admission table. They cover
 * neither custody nor separation: everything here runs at one uid.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateKeyPairSync, sign as edSign } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection } from 'node:net'
import { fileURLToPath } from 'node:url'
import {
  authorizationDigest,
  authorizationPreimage,
  authorizationSignedMessage,
  authorizationDigestBytes,
  verifyGrant,
  verifyGrantV4,
  grantPreimage,
  newNonce,
  payloadDigest,
  GRANT_DOMAIN,
  GRANT_DOMAIN_V4,
} from '@aukora/core/host-dsh/src/grant.mjs'
import { definitionDigest, MEMORY_PUT } from '@aukora/core/broker/effect.mjs'
import { buildOperation, operationDigest } from '@aukora/core/broker/operation.mjs'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const ISSUER_ENTRY = join(REPO_ROOT, 'aukora', 'issuer', 'issuer.mjs')
const PROMPT = /\+- approve\? type "yes ([0-9a-f]{16})": /
const RECEIPT_KEY_ID = 'f'.repeat(64)
const ARGS = { key: 'deploy', value: { path: '/tmp/x' } }

/** Build the claim set the broker owns, exactly as the broker would. */
function brokerClaims(exp: number): Parameters<typeof authorizationPreimage>[0] {
  return {
    toolName: MEMORY_PUT,
    digest: payloadDigest(MEMORY_PUT, ARGS),
    nonce: newNonce(),
    exp,
    definitionId: definitionDigest(),
    operationDigest: operationDigest(buildOperation(ARGS, exp)),
    receiptKeyId: RECEIPT_KEY_ID,
  }
}

describe('v4 authorization digest', () => {
  const exp = Math.floor(Date.now() / 1000) + 60
  const root = generateKeyPairSync('ed25519')
  const rootPem = root.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const common = {
    toolName: MEMORY_PUT,
    args: ARGS,
    rootPublicKeyPem: rootPem,
    now: Date.now(),
    expectedOperationDigest: operationDigest(buildOperation(ARGS, exp)),
    expectedDefinitionId: definitionDigest(),
    expectedReceiptKeyId: RECEIPT_KEY_ID,
  }
  const signDigest = (claims: Parameters<typeof authorizationPreimage>[0]): string =>
    edSign(null, authorizationSignedMessage(claims), root.privateKey).toString('base64')

  it('separates the two families by domain', () => {
    expect(GRANT_DOMAIN).toBe('aukora:tool-grant:v3')
    expect(GRANT_DOMAIN_V4).toBe('aukora:tool-grant:v4')
    const claims = brokerClaims(exp)
    expect(authorizationPreimage(claims).toString('utf8')).not.toBe(grantPreimage(claims).toString('utf8'))
  })

  it('is a stable 32-byte value over the closed claim set', () => {
    const claims = {
      toolName: 'memory.put',
      digest: 'a'.repeat(64),
      nonce: 'ab12',
      exp: 1,
      definitionId: 'b'.repeat(64),
      operationDigest: 'c'.repeat(64),
      receiptKeyId: 'd'.repeat(64),
    }
    // Known answer. A change here is a protocol change and must bump the domain.
    expect(authorizationDigest(claims)).toBe('69ade68c6b1a310492f62f36dd7d9be7d07718542236a6d6b2e47e600297f35b')
    expect(Buffer.from(authorizationDigest(claims), 'hex')).toHaveLength(32)
  })

  it('admits a grant assembled from claims plus a signature over the digest alone', () => {
    const claims = brokerClaims(exp)
    const grant = { ...claims, signature: signDigest(claims) }
    expect(verifyGrantV4({ ...common, grant, seenNonces: new Set() })).toMatchObject({ ok: true })
  })

  it('refuses a v4 signature under the v3 verifier and a v3 signature under the v4 verifier', () => {
    const claims = brokerClaims(exp)
    const v4 = { ...claims, signature: signDigest(claims) }
    const v3 = { ...claims, signature: edSign(null, grantPreimage(claims), root.privateKey).toString('base64') }
    // No input selects the family, so neither direction is a downgrade path.
    expect(verifyGrant({ ...common, grant: v4, seenNonces: new Set() })).toMatchObject({ reason: 'grant:signature-invalid' })
    expect(verifyGrantV4({ ...common, grant: v3, seenNonces: new Set() })).toMatchObject({ reason: 'grant:signature-invalid' })
  })

  it.each([
    ['nonce', { nonce: 'deadbeefdeadbeefdeadbeef' }],
    ['exp', { exp: exp + 1 }],
    ['digest', { digest: '9'.repeat(64) }],
    ['definitionId', { definitionId: '8'.repeat(64) }],
    ['operationDigest', { operationDigest: '7'.repeat(64) }],
    ['receiptKeyId', { receiptKeyId: '6'.repeat(64) }],
    ['toolName', { toolName: 'memory.delete' }],
  ])('refuses a grant whose %s changed after signing', (_field, patch) => {
    const claims = brokerClaims(exp)
    const grant = { ...claims, signature: signDigest(claims), ...patch }
    expect(verifyGrantV4({ ...common, grant, seenNonces: new Set() }).ok).toBe(false)
  })

  it('refuses an unsigned rider whole', () => {
    const claims = brokerClaims(exp)
    const grant = { ...claims, signature: signDigest(claims), extra: 1 }
    expect(verifyGrantV4({ ...common, grant, seenNonces: new Set() })).toMatchObject({ reason: 'grant:malformed' })
  })

  it('refuses anything that is not exactly the closed seven claims', () => {
    const base = brokerClaims(exp)
    const rider = { ...base, closureDigest: 'e'.repeat(64) }
    // The digest IS the authorization. A key outside the set must refuse, never
    // be dropped so the remaining seven hash anyway.
    expect(() => authorizationDigest(rider as never)).toThrow(/not exact/)
    const missing: Record<string, unknown> = { ...base }
    delete missing.nonce
    expect(() => authorizationDigest(missing as never)).toThrow(/not exact/)
    const accessor = Object.defineProperty({ ...base }, 'exp', { get: () => exp, enumerable: true })
    expect(() => authorizationDigest(accessor as never)).toThrow(/not exact/)
    const symboled = Object.assign({ ...base }, { [Symbol('rider')]: 1 })
    expect(() => authorizationDigest(symboled as never)).toThrow(/not exact/)
    expect(() => authorizationDigest([1, 2, 3] as never)).toThrow(/not exact/)
    expect(() => authorizationDigest({ ...base, digest: 'zz' })).toThrow(/not exact/)
    expect(() => authorizationDigest({ ...base, exp: 1.5 })).toThrow(/not exact/)
    // A null-prototype object carrying exactly the seven is accepted, matching
    // `snapshotGrant` in the same module: it cannot carry an inherited rider.
    const nullPrototype = Object.assign(Object.create(null) as typeof base, base)
    expect(authorizationDigest(nullPrototype)).toBe(authorizationDigest(base))
  })

  it('matches a known-answer vector derived separately from the implementation', () => {
    // A builder-owned known-answer vector, derived from the written v4
    // specification by a reader who did not open this implementation. Stronger
    // than producer-and-verifier agreement, weaker than an independent oracle:
    // one party still owns both sides. A disagreement is the finding.
    const fixed = {
      toolName: 'memory.put',
      digest: 'a'.repeat(64),
      nonce: 'ab12',
      exp: 1,
      definitionId: 'b'.repeat(64),
      operationDigest: 'c'.repeat(64),
      receiptKeyId: 'd'.repeat(64),
    }
    const EXPECTED_PREIMAGE = '{"definitionId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","domain":"aukora:tool-grant:v4","exp":1,"nonce":"ab12","operationDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","receiptKeyId":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","tool":"memory.put"}'
    const EXPECTED_DIGEST = '69ade68c6b1a310492f62f36dd7d9be7d07718542236a6d6b2e47e600297f35b'
    const EXPECTED_SIGNED_MESSAGE = '61756b6f72613a746f6f6c2d6772616e743a76340069ade68c6b1a310492f62f36dd7d9be7d07718542236a6d6b2e47e600297f35b'
    expect(authorizationPreimage(fixed).toString('utf8')).toBe(EXPECTED_PREIMAGE)
    expect(authorizationPreimage(fixed)).toHaveLength(401)
    expect(authorizationDigest(fixed)).toBe(EXPECTED_DIGEST)
    expect(authorizationSignedMessage(fixed).toString('hex')).toBe(EXPECTED_SIGNED_MESSAGE)
    expect(authorizationSignedMessage(fixed)).toHaveLength(53)
  })

  it('refuses a signature taken over the untagged digest', () => {
    const claims = brokerClaims(exp)
    // The domain tag is what stops this key's signature over some other
    // protocol's 32-byte digest from standing in for an authorization.
    const untagged = edSign(null, authorizationDigestBytes(claims), root.privateKey).toString('base64')
    expect(verifyGrantV4({ ...common, grant: { ...claims, signature: untagged }, seenNonces: new Set() }))
      .toMatchObject({ reason: 'grant:signature-invalid' })
  })

  it('spends the nonce once', () => {
    const claims = brokerClaims(exp)
    const grant = { ...claims, signature: signDigest(claims) }
    const seen = new Set<string>()
    expect(verifyGrantV4({ ...common, grant, seenNonces: seen })).toMatchObject({ ok: true })
    expect(verifyGrantV4({ ...common, grant, seenNonces: seen })).toMatchObject({ reason: 'grant:replayed' })
  })
})

describe('issuer digest admission', () => {
  let tempDir: string
  let socketPath: string
  let issuer: ChildProcess
  /** Prompt-matching buffer, cleared on each match so one challenge answers once. */
  let stderr = ''
  /** Everything the issuer ever wrote, retained for assertions about what it saw. */
  let transcript = ''
  let answerPrompts = true
  /** The public half of the key the running daemon signs with. */
  let daemonRootPem = ''

  const ask = (request: unknown, budgetMs = 35_000): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
    const connection = createConnection(socketPath)
    let buffer = ''
    let settled = false
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      connection.destroy()
      fn()
    }
    const timer = setTimeout(() => { settle(() => { reject(new Error(`issuer request exceeded ${budgetMs}ms`)) }) }, budgetMs)
    connection.once('error', (error: Error) => { settle(() => { reject(error) }) })
    // A close before a reply is its own named failure, never a hang.
    connection.once('close', () => {
      settle(() => { reject(new Error(`issuer closed without a reply; stderr: ${transcript.slice(-400)}`)) })
    })
    connection.once('connect', () => { connection.write(`${JSON.stringify(request)}\n`) })
    connection.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const cut = buffer.indexOf('\n')
      if (cut === -1) return
      settle(() => { resolve(JSON.parse(buffer.slice(0, cut)) as Record<string, unknown>) })
    })
  })

  /** Resolve once the issuer has actually written a prompt, so an answer is never sent into a dead channel. */
  const awaitPrompt = async (budgetMs = 5_000): Promise<string> => {
    const deadline = Date.now() + budgetMs
    for (;;) {
      const challenge = PROMPT.exec(stderr)?.[1]
      if (challenge !== undefined) return challenge
      if (Date.now() > deadline) throw new Error(`no prompt within ${budgetMs}ms; stderr: ${transcript.slice(-400)}`)
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }

  beforeEach(async () => {
    stderr = ''
    transcript = ''
    answerPrompts = true
    tempDir = mkdtempSync(join(tmpdir(), 'aukora-digest-hop-'))
    chmodSync(tempDir, 0o700)
    socketPath = join(tempDir, 'issuer.sock')
    const keyFile = join(tempDir, 'root.pem')
    const root = generateKeyPairSync('ed25519')
    daemonRootPem = root.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    writeFileSync(keyFile, root.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), { mode: 0o600 })
    chmodSync(keyFile, 0o600)
    issuer = spawn(process.execPath, [ISSUER_ENTRY], {
      env: {
        ...process.env,
        AUKORA_ISSUER_SOCKET: socketPath,
        AUKORA_ISSUER_KEY_FILE: keyFile,
        AUKORA_EXPECTED_RECEIPT_KEY_ID: RECEIPT_KEY_ID,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let childExit: { code: number | null; signal: string | null } | null = null
    issuer.once('exit', (code, signal) => { childExit = { code, signal } })
    issuer.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      stderr += text
      transcript += text
      const match = PROMPT.exec(stderr)
      if (match && answerPrompts) { stderr = ''; issuer.stdin?.write(`yes ${match[1]}\n`) }
    })
    // Observed readiness, not a fixed sleep: wait for the socket the issuer
    // creates, and name the real cause when the child dies instead of listening.
    // A sleep that is too short produced a run of opaque ENOENT connections.
    const listening = (): Promise<boolean> => new Promise((resolve) => {
      const probe = createConnection(socketPath)
      probe.once('connect', () => { probe.destroy(); resolve(true) })
      probe.once('error', () => { probe.destroy(); resolve(false) })
    })
    const ready = Date.now() + 10_000
    for (;;) {
      // A pathname can exist before listen(2) completes. Readiness is a
      // successful connection or a named child failure, never a stat.
      if (existsSync(socketPath) && await listening()) break
      const exit = childExit as { code: number | null; signal: string | null } | null
      if (exit !== null) {
        throw new Error(`issuer exited before listening: code=${exit.code} signal=${exit.signal}; stderr: ${transcript.slice(0, 600)}`)
      }
      if (Date.now() > ready) throw new Error(`issuer never listened within 10s; stderr: ${transcript.slice(0, 600)}`)
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  })

  afterEach(async () => {
    // Await the child's exit before removing the tree it holds a socket in, so
    // teardown cannot race a live process against a deleted directory.
    if (issuer.exitCode === null && issuer.signalCode === null) {
      const exited = new Promise<void>((resolve) => { issuer.once('exit', () => { resolve() }) })
      issuer.kill('SIGKILL')
      await exited
    }
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('signs only an admitted digest and returns a closed envelope', async () => {
    const digest = 'a'.repeat(64)
    expect(await ask({ op: 'admit', digest })).toEqual({ ok: true })
    const envelope = await ask({ op: 'authorize', digest })
    expect(Object.keys(envelope).sort()).toEqual(['digest', 'ok', 'signature'])
    expect(envelope.digest).toBe(digest)
  })

  it('never receives an argument, an operation, or a claim', async () => {
    const digest = 'b'.repeat(64)
    await ask({ op: 'admit', digest })
    await ask({ op: 'authorize', digest })
    // The prompt is the issuer's whole view of the request.
    expect(transcript).not.toContain('deploy')
    expect(transcript).toContain('the operation behind this digest is NOT shown')
  })

  it.each([
    ['never admitted', 'authorize', 'c'.repeat(64), 'issuer:digest-not-pending'],
    ['not hex', 'admit', 'nothex', 'issuer:digest-malformed'],
    ['unknown verb', 'nope', 'd'.repeat(64), 'issuer:unknown-op'],
  ])('refuses %s by name', async (_label, op, digest, reason) => {
    expect(await ask({ op, digest })).toEqual({ ok: false, reason })
  })

  it('refuses an admission carrying an extra field', async () => {
    expect(await ask({ op: 'admit', digest: 'e'.repeat(64), extra: 1 }))
      .toEqual({ ok: false, reason: 'issuer:admit-extra-fields' })
  })

  it('refuses a duplicate unresolved admission', async () => {
    const digest = '1'.repeat(64)
    expect(await ask({ op: 'admit', digest })).toEqual({ ok: true })
    expect(await ask({ op: 'admit', digest })).toEqual({ ok: false, reason: 'issuer:digest-already-pending' })
  })

  it('spends an admission on the answer, so an authorization never replays', async () => {
    const digest = '2'.repeat(64)
    await ask({ op: 'admit', digest })
    expect((await ask({ op: 'authorize', digest })).ok).toBe(true)
    expect(await ask({ op: 'authorize', digest })).toEqual({ ok: false, reason: 'issuer:digest-not-pending' })
  })

  it('spends an admission on an explicit denial, promptly', async () => {
    // The answer must be sent AFTER the prompt exists. Writing it first made the
    // issuer discard it as input-without-active-prompt, and the row then waited
    // out the 30s deadline and reported the timeout as a human denial.
    answerPrompts = false
    const digest = '3'.repeat(64)
    await ask({ op: 'admit', digest })
    const started = Date.now()
    const authorizing = ask({ op: 'authorize', digest })
    await awaitPrompt()
    issuer.stdin?.write('no\n')
    expect(await authorizing).toEqual({ ok: false, reason: 'issuer:human-denied' })
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(await ask({ op: 'authorize', digest })).toEqual({ ok: false, reason: 'issuer:digest-not-pending' })
  })

  it('produces a signature the v4 verifier admits and the v3 verifier refuses', async () => {
    // The only row that joins the running daemon's signature to the verifier.
    // Everything else in this file signs with a key the test itself holds.
    const exp = Math.floor(Date.now() / 1000) + 60
    const claims = brokerClaims(exp)
    const digest = authorizationDigest(claims)
    expect(await ask({ op: 'admit', digest })).toEqual({ ok: true })
    const envelope = await ask({ op: 'authorize', digest })
    expect(envelope.ok).toBe(true)
    const grant = { ...claims, signature: envelope.signature as string }
    const common = {
      toolName: MEMORY_PUT,
      args: ARGS,
      rootPublicKeyPem: daemonRootPem,
      now: Date.now(),
      expectedOperationDigest: operationDigest(buildOperation(ARGS, exp)),
      expectedDefinitionId: definitionDigest(),
      expectedReceiptKeyId: RECEIPT_KEY_ID,
    }
    expect(verifyGrantV4({ ...common, grant, seenNonces: new Set() })).toMatchObject({ ok: true })
    expect(verifyGrant({ ...common, grant, seenNonces: new Set() })).toMatchObject({ reason: 'grant:signature-invalid' })
  })

  it('refuses an admission with no digest field as missing, not as an extra field', async () => {
    expect(await ask({ op: 'admit', extra: 1 })).toEqual({ ok: false, reason: 'issuer:admit-digest-missing' })
    expect(await ask({ op: 'authorize', extra: 1 })).toEqual({ ok: false, reason: 'issuer:authorize-digest-missing' })
  })

  it('reports an absent input carrier as unavailable, never as a human denial', async () => {
    answerPrompts = false
    const digest = '4'.repeat(64)
    await ask({ op: 'admit', digest })
    issuer.stdin?.end()
    // No human saw this digest, so no human decision may be recorded for it.
    expect(await ask({ op: 'authorize', digest })).toEqual({ ok: false, reason: 'issuer:approval-unavailable' })
    // And with the carrier gone, a further admission is refused rather than banked.
    expect(await ask({ op: 'admit', digest: '5'.repeat(64) }))
      .toEqual({ ok: false, reason: 'issuer:approval-unavailable' })
  }, 40_000)

  it('does not spend an admission on a timeout, and the retry still works', async () => {
    // The real 30s deadline. It is a security invariant, not a tunable, so the
    // row pays it rather than shortening it.
    answerPrompts = false
    const digest = '6'.repeat(64)
    await ask({ op: 'admit', digest })
    expect(await ask({ op: 'authorize', digest })).toEqual({ ok: false, reason: 'issuer:approval-timeout' })
    // Nobody decided anything, so the admission survives and is claimable.
    answerPrompts = true
    stderr = ''
    expect((await ask({ op: 'authorize', digest })).ok).toBe(true)
  }, 90_000)

  it('refuses a second authorization while the first prompt is open', async () => {
    answerPrompts = false
    const first = 'a1'.repeat(32)
    const second = 'a2'.repeat(32)
    await ask({ op: 'admit', digest: first })
    await ask({ op: 'admit', digest: second })
    const pending = ask({ op: 'authorize', digest: first })
    await awaitPrompt()
    expect(await ask({ op: 'authorize', digest: second })).toEqual({ ok: false, reason: 'issuer:approval-busy' })
    // The busy refusal leaves both admissions intact.
    answerPrompts = true
    issuer.stdin?.write('no\n')
    await pending
    stderr = ''
    expect((await ask({ op: 'authorize', digest: second })).ok).toBe(true)
  }, 60_000)

  it('accepts exactly sixteen admissions and refuses the seventeenth', async () => {
    for (let index = 0; index < 16; index += 1) {
      expect(await ask({ op: 'admit', digest: index.toString(16).padStart(64, '0') })).toEqual({ ok: true })
    }
    expect(await ask({ op: 'admit', digest: 'f'.repeat(64) }))
      .toEqual({ ok: false, reason: 'issuer:pending-table-full' })
  })

  it('bounds the admission table before it can be exhausted', async () => {
    let refusal: Record<string, unknown> | null = null
    for (let index = 0; index < 32; index += 1) {
      const reply = await ask({ op: 'admit', digest: index.toString(16).padStart(64, '0') })
      if (reply.ok !== true) { refusal = reply; break }
    }
    expect(refusal).toEqual({ ok: false, reason: 'issuer:pending-table-full' })
  })
})
