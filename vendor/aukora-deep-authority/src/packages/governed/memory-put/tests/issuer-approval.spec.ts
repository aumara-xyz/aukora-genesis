import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateKeyPairSync, verify as edVerify, type KeyObject } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection, type Socket } from 'node:net'
import { fileURLToPath } from 'node:url'
import { effectBody } from '@aukora/core/broker/operation.mjs'
import { authorizationSignedMessageV5FromHex } from '@aukora/core/host-dsh/src/grant-v5.mjs'
import { approvalArtifactDigest, createApprovalArtifact } from '@aukora/core/approval/artifact.mjs'
import { authorizationSignedMessageFromHex } from '@aukora/core/host-dsh/src/grant.mjs'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const ISSUER_ENTRY = join(REPO_ROOT, 'aukora', 'issuer', 'issuer.mjs')
const PROMPT = /\+- approve\? type "yes ([0-9a-f]{16})": /

interface IssuerReply {
  ok: boolean
  reason?: string
}

describe('issuer approval serialization', () => {
  let tempDir: string
  let socketPath: string
  let issuer: ChildProcess
  let rootPublicKey: KeyObject
  let stderr = ''
  let promptCount = 0
  const promptChallenges: string[] = []
  const promptWaiters: Array<{ count: number; resolve: () => void }> = []

  beforeEach(async () => {
    stderr = ''
    promptCount = 0
    promptChallenges.length = 0
    promptWaiters.length = 0
    tempDir = mkdtempSync(join(tmpdir(), 'aukora-issuer-approval-'))
    socketPath = join(tempDir, 'issuer.sock')
    const keyFile = join(tempDir, 'root.pem')
    const root = generateKeyPairSync('ed25519')
    rootPublicKey = root.publicKey
    writeFileSync(keyFile, root.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), { mode: 0o600 })
    chmodSync(keyFile, 0o600)
    issuer = spawn(process.execPath, [ISSUER_ENTRY], {
      env: {
        ...process.env,
        AUKORA_ISSUER_SOCKET: socketPath,
        AUKORA_ISSUER_KEY_FILE: keyFile,
        AUKORA_EXPECTED_RECEIPT_KEY_ID: '0'.repeat(64),
      },
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    let pending = ''
    issuer.stderr?.on('data', (chunk: Buffer) => {
      const text = String(chunk)
      stderr += text
      pending += text
      let match
      while ((match = PROMPT.exec(pending)) !== null) {
        const challenge = match[1]
        if (challenge === undefined) throw new Error('issuer prompt omitted its challenge')
        promptCount += 1
        promptChallenges.push(challenge)
        pending = pending.slice(match.index + match[0].length)
        for (const waiter of [...promptWaiters]) {
          if (promptCount >= waiter.count) {
            promptWaiters.splice(promptWaiters.indexOf(waiter), 1)
            waiter.resolve()
          }
        }
      }
    })
    await waitForSocket(socketPath, () => stderr)
  })

  afterEach(async () => {
    if (issuer.exitCode === null) {
      issuer.kill()
      await new Promise(resolve => issuer.once('exit', resolve))
    }
    rmSync(tempDir, { recursive: true, force: true })
  })

  function waitForPrompts(count: number): Promise<void> {
    if (promptCount >= count) return Promise.resolve()
    return new Promise(resolve => promptWaiters.push({ count, resolve }))
  }

  function challengeForPrompt(count: number): string {
    const challenge = promptChallenges[count - 1]
    if (challenge === undefined) throw new Error(`prompt ${count} has no challenge`)
    return challenge
  }

  function within<T>(promise: Promise<T>, label: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(() => { reject(new Error(`${label}; prompts=${promptCount}; stderr=${stderr}`)) }, 2_000)
      }),
    ])
  }

  function waitForStderr(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 2_000
      const inspect = (): void => {
        if (stderr.includes(text)) resolve()
        else if (Date.now() >= deadline) reject(new Error(`stderr did not contain ${JSON.stringify(text)}: ${stderr}`))
        else setTimeout(inspect, 5)
      }
      inspect()
    })
  }

  function waitForAnyStderr(texts: readonly string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 2_000
      const inspect = (): void => {
        const found = texts.find(text => stderr.includes(text))
        if (found !== undefined) resolve(found)
        else if (Date.now() >= deadline) reject(new Error(`stderr contained none of ${JSON.stringify(texts)}: ${stderr}`))
        else setTimeout(inspect, 5)
      }
      inspect()
    })
  }

  function issueFrame(key: string, value: unknown = key): string {
    return issueArgumentsFrame({ key, value })
  }

  function issueArgumentsFrame(argumentsValue: unknown): string {
    return `${JSON.stringify({
      op: 'issue',
      toolName: 'memory.put',
      arguments: argumentsValue,
      expiry: Math.floor(Date.now() / 1000) + 300,
    })}\n`
  }

  function startConnection(payload?: string): { connection: Socket; reply: Promise<IssuerReply> } {
    const connection = createConnection(socketPath)
    const reply = new Promise<IssuerReply>((resolve, reject) => {
      let buffer = ''
      connection.once('error', (error) => { reject(error) })
      if (payload !== undefined) connection.once('connect', () => connection.write(payload))
      connection.on('data', (chunk: Buffer) => {
        buffer += String(chunk)
        const cut = buffer.indexOf('\n')
        if (cut === -1) return
        connection.destroy()
        resolve(JSON.parse(buffer.slice(0, cut)) as IssuerReply)
      })
    })
    return { connection, reply }
  }

  function startRequest(key: string): { connection: Socket; reply: Promise<IssuerReply> } {
    return startConnection(issueFrame(key))
  }

  function request(key: string): Promise<IssuerReply> {
    return startRequest(key).reply
  }

  it('keeps v5 admissions separate and signs the subject-bound domain', async () => {
    const digest = 'ab'.repeat(32)
    await expect(startConnection(`${JSON.stringify({ op: 'admit.v5', digest })}\n`).reply)
      .resolves.toEqual({ ok: true })
    await expect(startConnection(`${JSON.stringify({ op: 'admit', digest })}\n`).reply)
      .resolves.toEqual({ ok: true })
    const artifact = createApprovalArtifact({
      operationArguments: { key: 'v5-artifact', value: 'subject-bound' },
      expiry: Math.floor(Date.now() / 1000) + 300,
      activationDigest: '1'.repeat(64),
      occurrenceId: '2'.repeat(32),
      rendererId: '3'.repeat(64),
    })
    const authorized = startConnection(`${JSON.stringify({
      op: 'authorize.v5',
      digest,
      artifact,
      artifactDigest: approvalArtifactDigest(artifact),
    })}\n`).reply
    await waitForPrompts(1)
    expect(stderr).toContain(`approvalArtifactDigest: ${approvalArtifactDigest(artifact)}`)
    issuer.stdin?.write(`yes ${challengeForPrompt(1)}\n`)
    const reply = await authorized as IssuerReply & { digest: string; signature: string }
    expect(reply).toMatchObject({ ok: true, digest })
    expect(edVerify(
      null,
      authorizationSignedMessageV5FromHex(digest),
      rootPublicKey,
      Buffer.from(reply.signature, 'base64'),
    )).toBe(true)
    const v4Authorized = startConnection(`${JSON.stringify({ op: 'authorize', digest })}\n`).reply
    await waitForPrompts(2)
    issuer.stdin?.write(`yes ${challengeForPrompt(2)}\n`)
    const v4Reply = await v4Authorized as IssuerReply & { digest: string; signature: string }
    expect(v4Reply).toMatchObject({ ok: true, digest })
    expect(edVerify(
      null,
      authorizationSignedMessageFromHex(digest),
      rootPublicKey,
      Buffer.from(v4Reply.signature, 'base64'),
    )).toBe(true)
  })

  it('discards a complete answer delivered while no prompt is active', async () => {
    issuer.stdin?.write('yes stale-answer\n')
    await within(waitForStderr('issuer:input-without-active-prompt-discarded'), 'unprompted input was not observed')
    const reply = request('unprompted-input')
    await waitForPrompts(1)
    let settled = false
    void reply.then(() => { settled = true })
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(settled).toBe(false)
    issuer.stdin?.write(`yes ${challengeForPrompt(1)}\n`)
    await expect(reply).resolves.toMatchObject({ ok: true })
  })

  it('cannot replay an old challenge across request and stdin scheduling', async () => {
    const abandoned = startRequest('old-challenge')
    await waitForPrompts(1)
    const oldChallenge = challengeForPrompt(1)
    abandoned.connection.destroy()
    await waitForStderr('issuer:approval-request-cancelled')

    const delivery = waitForAnyStderr([
      'issuer:input-without-active-prompt-discarded',
      'issuer:approval-answer-mismatch',
    ])
    const replacement = request('new-challenge')
    issuer.stdin?.write(`yes ${oldChallenge}\n`)
    await waitForPrompts(2)
    expect(challengeForPrompt(2)).not.toBe(oldChallenge)
    if (await delivery === 'issuer:approval-answer-mismatch') {
      await expect(replacement).resolves.toMatchObject({
        ok: false,
        reason: 'issuer:human-denied-or-unavailable',
      })
    } else {
      issuer.stdin?.write(`yes ${challengeForPrompt(2)}\n`)
      await expect(replacement).resolves.toMatchObject({ ok: true })
    }
  })

  it('refuses plain yes without the visible challenge', async () => {
    const reply = request('plain-yes')
    await waitForPrompts(1)
    issuer.stdin?.write('yes\n')
    await expect(reply).resolves.toMatchObject({ ok: false, reason: 'issuer:human-denied-or-unavailable' })
  })

  it('refuses omitted values and rider fields without opening an approval prompt', async () => {
    const omitted = startConnection(issueArgumentsFrame({ key: 'omitted-value' })).reply
    await expect(within(omitted, 'omitted value did not refuse')).resolves.toMatchObject({
      ok: false,
      reason: 'issuer:arguments-not-exact',
    })

    const rider = startConnection(issueArgumentsFrame({ key: 'rider', value: 1, hidden: 'not-rendered' })).reply
    await expect(within(rider, 'rider field did not refuse')).resolves.toMatchObject({
      ok: false,
      reason: 'issuer:arguments-not-exact',
    })
    expect(promptCount).toBe(0)
  })

  it('prints one reversible object-body field without raw hostile controls', async () => {
    const value = 'line\r\nbytes: 0\u0000\u001b[31m\u0085\u2028tool: forged\u2029\u2066hidden\u2069\u00ad\ufe0f\u{e0061}'
    const reply = startConnection(issueFrame('hostile-prompt', value)).reply
    await waitForPrompts(1)

    const fields = stderr.split('\n').filter(line => line.startsWith('  | effectBodyUtf8: '))
    expect(fields).toHaveLength(1)
    const encoded = fields[0]?.slice('  | effectBodyUtf8: '.length)
    if (encoded === undefined) throw new Error('issuer prompt omitted effectBodyUtf8')
    expect(JSON.parse(encoded)).toBe(effectBody({ key: 'hostile-prompt', value }))
    expect(encoded).toContain(String.raw`\u2028`)
    expect(encoded).toContain(String.raw`\u2029`)
    expect(encoded).toContain(String.raw`\u00ad`)
    expect(encoded).toContain(String.raw`\ufe0f`)
    expect(encoded).toContain(String.raw`\udb40\udc61`)
    for (const ch of stderr) {
      const code = ch.codePointAt(0) ?? 0
      expect(code === 0x0a || (code >= 0x20 && code <= 0x7e)).toBe(true)
    }

    issuer.stdin?.write(`yes ${challengeForPrompt(1)}\n`)
    await expect(reply).resolves.toMatchObject({ ok: true })
  })

  it('waits for a complete input line before settling a prompt', async () => {
    const reply = request('fragmented-input')
    await waitForPrompts(1)
    let settled = false
    void reply.then(() => { settled = true })
    issuer.stdin?.write(`yes ${challengeForPrompt(1)}`)
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(settled).toBe(false)
    issuer.stdin?.write('\n')
    await expect(within(reply, 'complete approval line did not settle')).resolves.toMatchObject({ ok: true })
  })

  it('refuses a concurrent request instead of shortening its decision interval', async () => {
    const first = request('first-operation')
    await waitForPrompts(1)
    const second = request('second-operation')
    await expect(within(second, 'concurrent request did not refuse')).resolves.toMatchObject({
      ok: false,
      reason: 'issuer:approval-busy',
    })
    expect(promptCount).toBe(1)

    issuer.stdin?.write(`yes ${challengeForPrompt(1)}\n`)
    await expect(within(first, 'first request did not settle')).resolves.toMatchObject({ ok: true })

    const next = request('next-operation')
    await within(waitForPrompts(2), 'next prompt did not render after the active request settled')
    issuer.stdin?.write('n\n')
    await expect(within(next, 'next request did not settle')).resolves.toMatchObject({
      ok: false,
      reason: 'issuer:human-denied-or-unavailable',
    })
  })

  it('refuses a second frame on one connection regardless of stream chunking', async () => {
    const coalesced = startConnection(issueFrame('coalesced-first') + issueFrame('coalesced-second'))
    await expect(within(coalesced.reply, 'coalesced requests did not refuse')).resolves.toMatchObject({
      ok: false,
      reason: 'issuer:one-request-per-connection',
    })

    const afterCoalescedPrompt = promptCount + 1
    const afterCoalesced = request('after-coalesced')
    await within(waitForPrompts(afterCoalescedPrompt), 'coalesced refusal left an active prompt')
    issuer.stdin?.write(`yes ${challengeForPrompt(afterCoalescedPrompt)}\n`)
    await expect(within(afterCoalesced, 'request after coalesced refusal did not settle')).resolves.toMatchObject({
      ok: true,
    })

    const split = startConnection()
    await new Promise<void>((resolve, reject) => {
      split.connection.once('connect', () => {
        split.connection.write(issueFrame('split-first'))
        resolve()
      })
      split.connection.once('error', reject)
    })
    const splitPrompt = promptCount + 1
    await within(waitForPrompts(splitPrompt), 'split first request did not render')
    split.connection.write(issueFrame('split-second'))
    await expect(within(split.reply, 'split requests did not refuse')).resolves.toMatchObject({
      ok: false,
      reason: 'issuer:one-request-per-connection',
    })

    const afterSplitPrompt = promptCount + 1
    const afterSplit = request('after-split')
    await within(waitForPrompts(afterSplitPrompt), 'split refusal left an active prompt')
    issuer.stdin?.write(`yes ${challengeForPrompt(afterSplitPrompt)}\n`)
    await expect(within(afterSplit, 'request after split refusal did not settle')).resolves.toMatchObject({ ok: true })
  })

  it('closes an oversize connection after its terminal refusal even when the client remains writable', async () => {
    const connection = createConnection({ path: socketPath, allowHalfOpen: true })
    connection.on('error', () => { /* A write racing terminal close may report EPIPE. */ })
    let responseBuffer = ''
    const reply = new Promise<IssuerReply>((resolve) => {
      connection.on('data', (chunk: Buffer) => {
        responseBuffer += String(chunk)
        const cut = responseBuffer.indexOf('\n')
        if (cut !== -1) resolve(JSON.parse(responseBuffer.slice(0, cut)) as IssuerReply)
      })
    })
    const remoteEnded = new Promise<void>((resolve) => {
      connection.once('end', () => {
        // `allowHalfOpen` leaves this client writable after the issuer's FIN.
        // The follow-up reaches the exact state that previously kept the
        // issuer's data listener and oversized JS buffer alive.
        connection.write(issueFrame('post-oversize-fin'))
        resolve()
      })
    })
    const closed = new Promise<void>((resolve) => {
      connection.once('close', () => { resolve() })
    })

    try {
      await new Promise<void>((resolve, reject) => {
        connection.once('connect', () => {
          connection.write('x'.repeat(64 * 1024 + 1))
          resolve()
        })
        connection.once('error', reject)
      })
      await expect(within(reply, 'oversize frame did not receive a refusal')).resolves.toEqual({
        ok: false,
        reason: 'issuer:frame-oversize',
      })
      await within(remoteEnded, 'issuer did not end its response side after oversize refusal')
      await within(closed, 'issuer retained an allow-half-open oversize connection after follow-up bytes')
      expect(promptCount).toBe(0)
    } finally {
      connection.destroy()
    }

    const next = request('after-oversize')
    await within(waitForPrompts(1), 'issuer did not accept a fresh connection after oversize refusal')
    issuer.stdin?.write(`yes ${challengeForPrompt(1)}\n`)
    await expect(within(next, 'fresh request after oversize refusal did not settle')).resolves.toMatchObject({ ok: true })
  })

  it('does not carry a trailing line into the next prompt', async () => {
    const first = request('first-with-trailing-input')
    await waitForPrompts(1)
    issuer.stdin?.write(`yes ${challengeForPrompt(1)}\nyes ${challengeForPrompt(1)}\n`)
    await expect(first).resolves.toMatchObject({ ok: true })
    await waitForStderr('issuer:input-without-active-prompt-discarded')

    const second = request('after-trailing-input')
    await waitForPrompts(2)
    let settled = false
    void second.then(() => { settled = true })
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(settled).toBe(false)
    issuer.stdin?.write(`yes ${challengeForPrompt(2)}\n`)
    await expect(second).resolves.toMatchObject({ ok: true })
  })

  it('cancels an active approval when its requesting socket disconnects', async () => {
    const abandoned = startRequest('abandoned-operation')
    await waitForPrompts(1)
    abandoned.connection.destroy()
    await waitForStderr('issuer:approval-request-cancelled')

    const replacement = request('replacement-operation')
    await within(waitForPrompts(2), 'replacement prompt did not render after disconnect')
    issuer.stdin?.write('n\n')
    await expect(within(replacement, 'replacement request did not settle')).resolves.toMatchObject({
      ok: false,
      reason: 'issuer:human-denied-or-unavailable',
    })
  })

  it('refuses the active and later requests after the input carrier closes', async () => {
    const active = request('active-at-eof')
    await waitForPrompts(1)
    issuer.stdin?.end()
    await expect(active).resolves.toMatchObject({ ok: false, reason: 'issuer:human-denied-or-unavailable' })

    const later = request('after-eof')
    await expect(later).resolves.toMatchObject({ ok: false, reason: 'issuer:human-denied-or-unavailable' })
    expect(promptCount).toBe(1)
  })
})

function waitForSocket(path: string, lastError: () => string): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 10_000
    const attempt = (): void => {
      const connection = createConnection(path)
      connection.once('connect', () => { connection.destroy(); resolve() })
      connection.once('error', () => {
        if (Date.now() >= deadline) reject(new Error(`issuer socket did not accept: ${lastError()}`))
        else setTimeout(attempt, 20)
      })
    }
    attempt()
  })
}
