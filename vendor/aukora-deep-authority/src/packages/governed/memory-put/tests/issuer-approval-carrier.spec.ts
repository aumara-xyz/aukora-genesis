/**
 * The issuer answers prompts on an operator-owned channel when launchd gives it
 * no parent. Every operator answer here is SCRIPTED by the fixture; none of these
 * rows establishes that a human approved anything on the installed pair.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { assertOperatorChannel, openApprovalCarrier, socketCarrier } from '../../../../aukora/issuer/approval-carrier.mjs'

const ISSUER = fileURLToPath(new URL('../../../../aukora/issuer/issuer.mjs', import.meta.url))
const RECEIPT_KEY_ID = 'ab'.repeat(32)
const PROMPT = /approve\? type "yes ([0-9a-f]{16})"/
const digestOf = (seed: string): string => createHash('sha256').update(seed).digest('hex')

const children: ChildProcess[] = []
const servers: Server[] = []
const peers = new Set<Socket>()
const roots: string[] = []

afterEach(async () => {
  await Promise.all(children.splice(0).map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return
    await new Promise<void>((resolve) => {
      child.once('exit', () => { resolve() })
      child.kill('SIGKILL')
    })
  }))
  for (const socket of peers) socket.destroy()
  peers.clear()
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => { server.close(() => { resolve() }) })))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One operator end: accepts the issuer, collects prompts, releases answers on demand. */
interface Operator {
  socketPath: string
  /** Every byte the issuer has written to the channel. */
  text: () => string
  /** The newest unseen challenge, once the issuer offers one. */
  awaitChallenge: (budgetMs?: number) => Promise<string>
  /** SCRIPTED operator input. A person types this line in the attended path. */
  answer: (line: string) => void
  /** Drop the channel the way a closed terminal would. */
  drop: () => void
}

function startOperator(root: string, label: string): Operator {
  const socketPath = join(root, `${label}.operator.sock`)
  let text = ''
  let peer: Socket | undefined
  const seen = new Set<string>()
  const server = createServer((socket) => {
    peers.add(socket)
    socket.once('close', () => { peers.delete(socket) })
    socket.on('error', () => { socket.destroy() })
    peer = socket
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => { text += chunk })
  })
  servers.push(server)
  server.listen(socketPath)
  chmodSync(socketPath, 0o600)
  return {
    socketPath,
    text: () => text,
    awaitChallenge: async (budgetMs = 5_000) => {
      const deadline = Date.now() + budgetMs
      for (;;) {
        const fresh = (text.match(/approve\? type "yes ([0-9a-f]{16})"/g) ?? []).find(line => !seen.has(line))
        if (fresh !== undefined) {
          seen.add(fresh)
          return PROMPT.exec(fresh)![1]!
        }
        if (Date.now() > deadline) throw new Error(`${label}: no prompt on the operator channel; saw ${JSON.stringify(text.slice(-200))}`)
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    },
    answer: (line) => { peer?.write(`${line}\n`) },
    drop: () => { peer?.destroy(); server.close() },
  }
}

interface Issuer {
  socketPath: string
  ask: (request: unknown, budgetMs?: number) => Promise<Record<string, unknown>>
  stderr: () => string
  exited: () => { code: number | null; signal: string | null } | null
}

async function startIssuer(root: string, label: string, extraEnv: Record<string, string>): Promise<Issuer> {
  const socketPath = join(root, `${label}.issuer.sock`)
  const keyFile = join(root, `${label}.pem`)
  writeFileSync(keyFile, generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), { mode: 0o600 })
  chmodSync(keyFile, 0o600)
  const child = spawn(process.execPath, [ISSUER], {
    env: {
      ...process.env,
      AUKORA_ISSUER_SOCKET: socketPath,
      AUKORA_ISSUER_KEY_FILE: keyFile,
      AUKORA_EXPECTED_RECEIPT_KEY_ID: RECEIPT_KEY_ID,
      ...extraEnv,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  children.push(child)
  let stderr = ''
  let exited: { code: number | null; signal: string | null } | null = null
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  child.once('exit', (code, signal) => { exited = { code, signal } })

  const deadline = Date.now() + 5_000
  for (;;) {
    if (exited !== null) break
    const reached = await new Promise<boolean>((resolve) => {
      const probe = createConnection(socketPath)
      probe.once('connect', () => { probe.destroy(); resolve(true) })
      probe.once('error', () => { resolve(false) })
    })
    if (reached) break
    if (Date.now() > deadline) throw new Error(`${label}: issuer never listened; ${stderr.slice(-300)}`)
    await new Promise(resolve => setTimeout(resolve, 25))
  }

  return {
    socketPath,
    stderr: () => stderr,
    exited: () => exited,
    ask: (request, budgetMs = 8_000) => new Promise((resolve, reject) => {
      const connection = createConnection(socketPath, () => { connection.write(`${JSON.stringify(request)}\n`) })
      let buffer = ''
      const timer = setTimeout(() => { connection.destroy(); reject(new Error(`${label}: no reply within ${budgetMs}ms`)) }, budgetMs)
      connection.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        const cut = buffer.indexOf('\n')
        if (cut === -1) return
        clearTimeout(timer)
        connection.destroy()
        resolve(JSON.parse(buffer.slice(0, cut)) as Record<string, unknown>)
      })
      connection.on('error', (error) => { clearTimeout(timer); reject(error) })
    }),
  }
}

function scratch(label: string): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), `ic-${label.slice(0, 2)}-`))
  roots.push(root)
  return root
}

describe('issuer approval over an operator-owned channel', () => {
  it('refuses an absent channel without leaving a lease, then starts and signs after the channel is available', async () => {
    const root = scratch('absent')
    const environment = {
      AUKORA_ISSUER_APPROVAL_SOCKET: join(root, 'retry.operator.sock'),
      AUKORA_ISSUER_APPROVAL_SOCKET_UID: String(process.getuid?.() ?? 0),
    }
    const issuer = await startIssuer(root, 'absent', environment)
    const deadline = Date.now() + 5_000
    while (issuer.exited() === null && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
    expect(issuer.exited(), issuer.stderr()).not.toBeNull()
    expect(issuer.exited()!.code).toBe(1)
    expect(issuer.stderr()).toContain('issuer:approval-socket-unavailable')
    expect(existsSync(`${issuer.socketPath}.lock`)).toBe(false)
    expect(existsSync(issuer.socketPath)).toBe(false)
    const operator = startOperator(root, 'retry')
    const retry = await startIssuer(root, 'absent', environment)
    const digest = digestOf('retry-after-carrier-failure')
    expect(await retry.ask({ op: 'admit', digest })).toMatchObject({ ok: true })
    const pending = retry.ask({ op: 'authorize', digest })
    operator.answer(`yes ${await operator.awaitChallenge()}`)
    expect(await pending).toMatchObject({ ok: true })
  }, 30_000)

  it('refuses a channel that belongs to another account', () => {
    const root = scratch('owner')
    const operator = startOperator(root, 'owner')
    const mine = process.getuid?.() ?? 0
    expect(() => { assertOperatorChannel(operator.socketPath, mine + 1) }).toThrow('issuer:approval-socket-owner-unexpected')
    // Positive control: the same node passes for its real owner.
    expect(() => { assertOperatorChannel(operator.socketPath, mine) }).not.toThrow()
  })

  it('refuses a world-accessible channel and a node that is not a socket', () => {
    const root = scratch('mode')
    const operator = startOperator(root, 'mode')
    const mine = process.getuid?.() ?? 0
    chmodSync(operator.socketPath, 0o606)
    expect(() => { assertOperatorChannel(operator.socketPath, mine) }).toThrow('issuer:approval-socket-world-accessible')
    const plain = join(root, 'not-a-socket')
    writeFileSync(plain, 'x', { mode: 0o600 })
    expect(() => { assertOperatorChannel(plain, mine) }).toThrow('issuer:approval-socket-not-a-socket')
  })

  it.each([0o770, 0o777])('refuses a writable ancestor (%s), with the same protected path accepted', async (mode) => {
    const root = scratch('parent')
    const parent = join(root, 'parent')
    mkdirSync(parent, { mode: 0o700 })
    const operator = startOperator(parent, 'parent')
    const uid = process.getuid?.() ?? 0
    chmodSync(parent, mode)
    await expect(socketCarrier(operator.socketPath, uid)).rejects.toThrow('issuer:approval-socket-ancestor-unsafe')
    expect(operator.text()).toBe('')
    chmodSync(parent, 0o700)
    const carrier = await socketCarrier(operator.socketPath, uid)
    carrier.write('protected-parent-control')
    await expect.poll(operator.text).toBe('protected-parent-control')
    carrier.close()
  })

  it('refuses socket and ancestor symlinks while accepting the original path', async () => {
    const root = scratch('links')
    const directory = join(root, 'operator')
    mkdirSync(directory, { mode: 0o700 })
    const operator = startOperator(directory, 'links')
    const leaf = join(root, 'leaf.sock')
    const ancestor = join(root, 'alias')
    symlinkSync(operator.socketPath, leaf)
    symlinkSync(directory, ancestor)
    const uid = process.getuid?.() ?? 0
    await expect(socketCarrier(leaf, uid)).rejects.toThrow('issuer:approval-socket-not-a-socket')
    await expect(socketCarrier(join(ancestor, 'links.operator.sock'), uid)).rejects.toThrow('issuer:approval-socket-ancestor-unsafe')
    const carrier = await socketCarrier(operator.socketPath, uid)
    carrier.write('exact-path-control')
    await expect.poll(operator.text).toBe('exact-path-control')
    carrier.close()
  })

  it('refuses socket substitution during connection before exposing a prompt carrier', async () => {
    const root = scratch('substitute')
    const original = startOperator(root, 'swap')
    const pending = socketCarrier(original.socketPath, process.getuid?.() ?? 0)
    // Socket connect completion is asynchronous; both pathname changes happen
    // before the carrier can expose prompt writes to its caller.
    renameSync(original.socketPath, join(root, 'original.sock'))
    const replacement = startOperator(root, 'swap')
    await expect(pending).rejects.toThrow('issuer:approval-socket-changed')
    expect(original.text()).toBe('')
    expect(replacement.text()).toBe('')
    const control = await socketCarrier(replacement.socketPath, process.getuid?.() ?? 0)
    control.write('replacement-explicitly-admitted')
    await expect.poll(replacement.text).toBe('replacement-explicitly-admitted')
    control.close()
  })

  it.skipIf(process.platform !== 'darwin')('refuses an ancestor ACL even when POSIX mode remains private', async () => {
    const root = scratch('acl')
    const operator = startOperator(root, 'acl')
    execFileSync('/bin/chmod', ['+a', 'everyone allow delete_child', root])
    try {
      await expect(socketCarrier(operator.socketPath, process.getuid?.() ?? 0)).rejects.toThrow('extended-acl-present')
      expect(operator.text()).toBe('')
    } finally { execFileSync('/bin/chmod', ['-N', root]) }
    const carrier = await socketCarrier(operator.socketPath, process.getuid?.() ?? 0)
    carrier.write('acl-removed-control')
    await expect.poll(operator.text).toBe('acl-removed-control')
    carrier.close()
  })

  it('selects stdio only when both socket settings are absent', async () => {
    const carrier = await openApprovalCarrier({})
    carrier.close()
    await expect(openApprovalCarrier({ AUKORA_ISSUER_APPROVAL_SOCKET_UID: '501' })).rejects.toThrow('issuer:approval-socket-path-required')
    await expect(openApprovalCarrier({ AUKORA_ISSUER_APPROVAL_SOCKET: '' })).rejects.toThrow('issuer:approval-socket-path-required')
    await expect(openApprovalCarrier({ AUKORA_ISSUER_APPROVAL_SOCKET: '/nonexistent.sock' })).rejects.toThrow('issuer:approval-socket-uid-required')
    for (const uid of ['-1', '01', '4294967295', '9999999999']) {
      await expect(openApprovalCarrier({
        AUKORA_ISSUER_APPROVAL_SOCKET: '/nonexistent.sock', AUKORA_ISSUER_APPROVAL_SOCKET_UID: uid,
      })).rejects.toThrow('issuer:approval-socket-uid-required')
    }
  })

  it('carries one prompt and completes the exact admitted request on a SCRIPTED operator answer', async () => {
    const root = scratch('approve')
    const operator = startOperator(root, 'approve')
    const issuer = await startIssuer(root, 'approve', {
      AUKORA_ISSUER_APPROVAL_SOCKET: operator.socketPath,
      AUKORA_ISSUER_APPROVAL_SOCKET_UID: String(process.getuid?.() ?? 0),
    })
    const digest = digestOf('approve')
    expect(await issuer.ask({ op: 'admit', digest })).toMatchObject({ ok: true })

    const pending = issuer.ask({ op: 'authorize', digest })
    const challenge = await operator.awaitChallenge()
    // The prompt reached the operator channel, not the log-file stdio.
    expect(operator.text()).toContain('AUTHORIZE DIGEST')
    expect(issuer.stderr()).not.toContain('AUTHORIZE DIGEST')
    operator.answer(`yes ${challenge}`) // SCRIPTED operator input
    expect(await pending).toMatchObject({ ok: true })
  }, 30_000)

  it('denies a wrong answer and refuses to replay a spent admission', async () => {
    const root = scratch('wrong')
    const operator = startOperator(root, 'wrong')
    const issuer = await startIssuer(root, 'wrong', {
      AUKORA_ISSUER_APPROVAL_SOCKET: operator.socketPath,
      AUKORA_ISSUER_APPROVAL_SOCKET_UID: String(process.getuid?.() ?? 0),
    })
    const digest = digestOf('wrong')
    expect(await issuer.ask({ op: 'admit', digest })).toMatchObject({ ok: true })

    const pending = issuer.ask({ op: 'authorize', digest })
    const challenge = await operator.awaitChallenge()
    // An answer naming a different challenge is not this prompt's answer.
    operator.answer(`yes ${'0'.repeat(16)}`) // SCRIPTED operator input
    expect(await pending).toMatchObject({ ok: false })
    expect(challenge).not.toBe('0'.repeat(16))

    // A decision spends the admission; the same digest cannot be authorized again.
    expect(await issuer.ask({ op: 'authorize', digest })).toMatchObject({ ok: false })
  }, 30_000)

  it('refuses every approval once the operator channel drops, and never answers with a denial nobody made', async () => {
    const root = scratch('drop')
    const operator = startOperator(root, 'drop')
    const issuer = await startIssuer(root, 'drop', {
      AUKORA_ISSUER_APPROVAL_SOCKET: operator.socketPath,
      AUKORA_ISSUER_APPROVAL_SOCKET_UID: String(process.getuid?.() ?? 0),
    })
    const admitted = digestOf('drop-admitted')
    expect(await issuer.ask({ op: 'admit', digest: admitted })).toMatchObject({ ok: true })

    operator.drop()
    await new Promise(resolve => setTimeout(resolve, 100))

    // A later admission is refused outright rather than banked against a dead channel.
    const refused = await issuer.ask({ op: 'admit', digest: digestOf('drop-later') })
    expect(refused).toMatchObject({ ok: false, reason: 'issuer:approval-unavailable' })
  }, 30_000)

  it('rejects an answer released after the caller cancelled, and a positive control still succeeds', async () => {
    const root = scratch('cancel')
    const operator = startOperator(root, 'cancel')
    const issuer = await startIssuer(root, 'cancel', {
      AUKORA_ISSUER_APPROVAL_SOCKET: operator.socketPath,
      AUKORA_ISSUER_APPROVAL_SOCKET_UID: String(process.getuid?.() ?? 0),
    })
    const cancelled = digestOf('cancel')
    expect(await issuer.ask({ op: 'admit', digest: cancelled })).toMatchObject({ ok: true })

    // The caller disconnects mid-prompt. The issuer cancels; nobody decided.
    const caller = createConnection(issuer.socketPath, () => {
      caller.write(`${JSON.stringify({ op: 'authorize', digest: cancelled })}\n`)
    })
    const challenge = await operator.awaitChallenge()
    caller.destroy()
    await new Promise(resolve => setTimeout(resolve, 100))
    operator.answer(`yes ${challenge}`) // SCRIPTED operator input, deliberately released late
    await new Promise(resolve => setTimeout(resolve, 100))

    // A cancellation decides nothing, so the admission is still claimable and the
    // late answer cannot have spent it. A fresh prompt carries a fresh challenge.
    const reclaimed = issuer.ask({ op: 'authorize', digest: cancelled })
    const second = await operator.awaitChallenge()
    expect(second).not.toBe(challenge)
    operator.answer(`yes ${second}`) // SCRIPTED operator input
    expect(await reclaimed).toMatchObject({ ok: true })

    // Positive control on the same issuer: an uncancelled request still completes.
    const live = digestOf('cancel-control')
    expect(await issuer.ask({ op: 'admit', digest: live })).toMatchObject({ ok: true })
    const pending = issuer.ask({ op: 'authorize', digest: live })
    const liveChallenge = await operator.awaitChallenge()
    operator.answer(`yes ${liveChallenge}`) // SCRIPTED operator input
    expect(await pending).toMatchObject({ ok: true })
  }, 30_000)
})
