/** Issuer prompts remain complete and unavailable reviewers produce no signing answer. */
import { ChildProcess, spawn, spawnSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createApprovalArtifact } from '../aukora/approval/artifact.mjs'
import { renderApprovalArtifact } from '../aukora/approval/render.mjs'
import {
  installIssuerApprovalBridge,
  type DeveloperIssuerApproval,
  type DeveloperIssuerApprovalRequest,
} from '../aukora/supervisor/issuer-approval-bridge.mjs'
import type { DeveloperLaunchError } from '../aukora/supervisor/developer-launch-error.mjs'

const CHALLENGE = 'ab'.repeat(8)
const DIGEST = 'cd'.repeat(32)
const checkout = fileURLToPath(new URL('..', import.meta.url))
const issuerModule = new URL('../aukora/issuer/issuer.mjs', import.meta.url).href
const disposers: Array<() => void> = []
const nextTurn = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

/** A real issuer frame with its digest-only warning and fresh challenge. */
function digestPrompt(challenge = CHALLENGE): string {
  return '  +- AUTHORIZE DIGEST -----------------------------------------\n'
    + '  | DIGEST APPROVAL - the operation behind this digest is NOT shown\n'
    + '  | and cannot be recovered from it. Confirm only if you know why\n'
    + '  | this digest was admitted.\n  | \n'
    + `  | authorizationDigest: ${DIGEST}\n`
    + `  +- approve? type "yes ${challenge}": `
}

/** Pipes exercise framing without launching an application or accessing a terminal. */
function streamBridge(approve: DeveloperIssuerApproval) {
  const child = Object.assign(new ChildProcess(), {
    stdin: new PassThrough(),
    stderr: new PassThrough(),
  })
  const requests: Readonly<DeveloperIssuerApprovalRequest>[] = []
  const failures: DeveloperLaunchError[] = []
  let written = ''
  let projected = ''
  child.stdin.on('data', (chunk: Buffer) => { written += chunk.toString('utf8') })
  installIssuerApprovalBridge(child, (request, signal) => {
    requests.push(request)
    return approve(request, signal)
  }, (text) => { projected += text }, (error) => { failures.push(error) })
  disposers.push(() => {
    child.emit('exit', 0, null)
    child.stdin.destroy()
    child.stderr.destroy()
  })
  return {
    child, requests, failures,
    get written() { return written },
    get projected() { return projected },
  }
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
})

describe('issuer approval bridge', () => {
  it('loads under plain Node without the developer launcher or workspace packages', () => {
    const root = mkdtempSync(join(tmpdir(), 'issuer-bridge-import-'))
    try {
      for (const name of ['issuer-approval-bridge.mjs', 'developer-launch-error.mjs']) {
        copyFileSync(join(checkout, 'aukora', 'supervisor', name), join(root, name))
      }
      const result = spawnSync(process.execPath, ['--input-type=module', '-e',
        "import { installIssuerApprovalBridge } from './issuer-approval-bridge.mjs'; "
        + "if (typeof installIssuerApprovalBridge !== 'function') process.exitCode = 1;",
      ], { cwd: root, env: {}, encoding: 'utf8', timeout: 5_000 })
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('carries the complete digest prompt across chunks without preceding diagnostics', async () => {
    const bridge = streamBridge(() => 'approved')
    const prompt = digestPrompt()
    const first = prompt.indexOf('authorizationDigest') + 10
    bridge.child.stderr.write(`issuer:diagnostic\n${prompt.slice(0, first)}`)
    await nextTurn()
    expect(bridge.requests).toEqual([])
    expect(bridge.written).toBe('')
    bridge.child.stderr.write(prompt.slice(first))
    await nextTurn()
    expect(bridge.requests).toEqual([{ challenge: CHALLENGE, prompt, authorizationDigest: DIGEST }])
    expect(Object.isFrozen(bridge.requests[0])).toBe(true)
    expect(bridge.written).toBe(`yes ${CHALLENGE}\n`)
    expect(bridge.projected).toBe(`issuer:diagnostic\n${prompt}`)
    expect(bridge.failures).toEqual([])
  })

  it('preserves the actual artifact frame and the challenge-only callback', async () => {
    const artifact = createApprovalArtifact({
      operationArguments: { key: 'notes.bridge', value: { note: 'exact operation' } },
      expiry: Math.floor(Date.now() / 1_000) + 60,
      activationDigest: 'a1'.repeat(32),
      occurrenceId: 'b2'.repeat(16),
      rendererId: 'c3'.repeat(32),
    })
    const prompt = renderApprovalArtifact(artifact, CHALLENGE)
    const bridge = streamBridge(({ challenge }) => challenge === CHALLENGE ? 'denied' : 'approved')
    bridge.child.stderr.write(prompt)
    await nextTurn()
    expect(bridge.requests).toEqual([{ challenge: CHALLENGE, prompt }])
    expect(bridge.written).toBe('no\n')
    expect(bridge.failures).toEqual([])
  })

  it('preserves split UTF-8 bytes in a legacy memory prompt', async () => {
    const prompt = '  +- MEMORY.WRITE ---------------------------------------------\n'
      + `  | note: café\n  +- approve? type "yes ${CHALLENGE}": `
    const bytes = Buffer.from(prompt)
    const split = bytes.indexOf(Buffer.from('é')) + 1
    const bridge = streamBridge(() => 'denied')
    bridge.child.stderr.write(bytes.subarray(0, split))
    bridge.child.stderr.write(bytes.subarray(split))
    await nextTurn()
    expect(bridge.requests).toEqual([{ challenge: CHALLENGE, prompt }])
    expect(bridge.projected).toBe(prompt)
    expect(bridge.failures).toEqual([])
  })

  it.each(['one chunk', 'split chunks'])('refuses an oversized complete frame in %s without accepting its suffix', async (mode) => {
    const bridge = streamBridge(() => 'approved')
    const prefix = '  +- AUTHORIZE DIGEST -----------------------------------------\n'
      + `  | ${'é'.repeat(70_000)}`
    const suffix = `\n  | authorizationDigest: ${DIGEST}\n  +- approve? type "yes ${CHALLENGE}": `
    if (mode === 'one chunk') bridge.child.stderr.write(prefix + suffix)
    else {
      bridge.child.stderr.write(prefix)
      bridge.child.stderr.write(suffix)
    }
    bridge.child.stderr.write(digestPrompt())
    await nextTurn()
    expect(bridge.requests).toEqual([])
    expect(bridge.written).toBe('')
    expect(bridge.failures).toMatchObject([{ reason: 'supervisor:issuer-prompt-too-large' }])
  })

  it.each(['missing', 'duplicate'])('refuses a digest frame with a %s digest', async (kind) => {
    const line = `  | authorizationDigest: ${DIGEST}\n`
    const prompt = digestPrompt().replace(line, kind === 'missing' ? '' : line + line)
    const bridge = streamBridge(() => 'approved')
    bridge.child.stderr.write(prompt)
    await nextTurn()
    expect(bridge.requests).toEqual([])
    expect(bridge.written).toBe('')
    expect(bridge.failures).toMatchObject([{ reason: 'supervisor:issuer-prompt-malformed' }])
  })

  it('fails the assembly when a reviewer throws', async () => {
    const bridge = streamBridge(() => { throw new Error('reviewer failed') })
    bridge.child.stderr.write(digestPrompt())
    await nextTurn()
    expect(bridge.written).toBe('')
    expect(bridge.failures).toMatchObject([{ reason: 'supervisor:issuer-approval-channel-failed' }])
  })

  it.each(['exit', 'close'])('does not start queued approvals after issuer %s', async (event) => {
    const bridge = streamBridge(() => 'approved')
    bridge.child.stderr.write(digestPrompt())
    bridge.child.emit(event, 0, null)
    await nextTurn()
    expect(bridge.requests).toEqual([])
    expect(bridge.written).toBe('')
    expect(bridge.failures).toEqual([])
  })

  it('aborts active approval and discards queued prompts when issuer closes', async () => {
    let finish: ((value: 'approved') => void) | undefined
    let approvalSignal: AbortSignal | undefined
    const bridge = streamBridge((_request, signal) => {
      approvalSignal = signal
      return new Promise<'approved'>((resolve) => { finish = resolve })
    })
    bridge.child.stderr.write(digestPrompt() + digestPrompt('12'.repeat(8)))
    await nextTurn()
    expect(bridge.requests).toHaveLength(1)
    bridge.child.emit('close', 0, null)
    finish?.('approved')
    await nextTurn()
    expect(approvalSignal?.aborted).toBe(true)
    expect(bridge.requests).toHaveLength(1)
    expect(bridge.written).toBe('')
    expect(bridge.failures).toMatchObject([{ reason: 'supervisor:issuer-approval-cancelled' }])
  })

  it('stops projection and detaches its stream listeners after issuer exit', async () => {
    const bridge = streamBridge(() => 'approved')
    bridge.child.emit('exit', 0, null)
    bridge.child.stderr.write(digestPrompt())
    await nextTurn()
    expect(bridge.projected).toBe('')
    expect(bridge.requests).toEqual([])
    expect(bridge.child.stderr.listenerCount('data')).toBe(0)
    expect(bridge.child.stdin.listenerCount('error')).toBe(0)
  })

  it.each(['stdin', 'stderr'] as const)('does not start a queued approval after %s closes', async (stream) => {
    const bridge = streamBridge(() => 'approved')
    bridge.child.stderr.write(digestPrompt())
    bridge.child[stream].destroy()
    await nextTurn()
    expect(bridge.requests).toEqual([])
    expect(bridge.written).toBe('')
  })

  // The issuer's Unix socket and graceful SIGTERM lifecycle are not Windows mechanisms.
  it.skipIf(process.platform === 'win32')('leaves an unavailable prompt unanswered while the real issuer expires it and serves the next review', async () => {
    const root = mkdtempSync(join(tmpdir(), 'issuer-bridge-'))
    const privatePath = join(root, 'root.pem')
    const { privateKey } = generateKeyPairSync('ed25519')
    writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' })
    // The unmodified issuer owns the 30-second deadline and both refusal results.
    const source = `
      const issuer = await import(${JSON.stringify(issuerModule)});
      const digest = ${JSON.stringify(DIGEST)};
      const admission = await issuer.handleAdmitV5({ op: 'admit.v5', digest });
      process.stdout.write(JSON.stringify(admission) + '\\n');
      for (let index = 0; index < 2; index++) {
        const result = await issuer.handleAuthorizeV5({ op: 'authorize.v5', digest });
        process.stdout.write(JSON.stringify(result) + '\\n');
      }
      process.kill(process.pid, 'SIGTERM');
    `
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
      cwd: checkout,
      env: {
        AUKORA_ISSUER_SOCKET: join(root, 'issuer.sock'),
        AUKORA_ISSUER_KEY_FILE: privatePath,
        AUKORA_EXPECTED_RECEIPT_KEY_ID: 'ef'.repeat(32),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 35_000,
    })
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => { resolve({ code, signal }) })
    })
    let output = ''
    let diagnostics = ''
    let reviews = 0
    const failures: DeveloperLaunchError[] = []
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
    installIssuerApprovalBridge(child, () => ++reviews === 1 ? 'unavailable' : 'denied', (text) => { diagnostics += text }, (error) => {
      failures.push(error)
      child.kill('SIGTERM')
    })
    try {
      expect(await exited, diagnostics).toEqual({ code: 0, signal: null })
      expect(failures).toEqual([])
      expect(reviews).toBe(2)
      expect(output.trim().split('\n').map((line): unknown => JSON.parse(line))).toEqual([
        { ok: true },
        { ok: false, reason: 'issuer:approval-timeout' },
        { ok: false, reason: 'issuer:human-denied' },
      ])
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      await exited.catch(() => {})
      rmSync(root, { recursive: true, force: true })
    }
  }, 40_000)
})
