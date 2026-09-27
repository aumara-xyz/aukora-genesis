/**
 * Discriminating evidence for the issuer's approval lifecycle.
 *
 * Each row here runs a COPY of the issuer with a named source substitution, so
 * the behaviour under test is observable without a production test hook and
 * without a configurable security invariant. Every substitution is asserted to
 * have applied, because a mutation that silently failed to apply would make the
 * row pass for the wrong reason.
 *
 * `AUKORA_TEST_ISSUER_SRC` selects an alternate issuer source for
 * mutation-sensitivity runs. It is read only by this file and has no production
 * reader.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection } from 'node:net'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const ISSUER_SRC = process.env.AUKORA_TEST_ISSUER_SRC ?? join(REPO_ROOT, 'aukora', 'issuer', 'issuer.mjs')
const PROMPT = /approve\? type "yes ([0-9a-f]{16})"/
const RECEIPT_KEY_ID = 'f'.repeat(64)

interface Mutant {
  readonly child: ChildProcess
  readonly socketPath: string
  stderr(): string
  signingReached(): boolean
  open(request: unknown, budgetMs?: number): {
    readonly reply: Promise<Record<string, unknown>>
    disconnect(): void
  }
  ask(request: unknown, budgetMs?: number): Promise<Record<string, unknown>>
  awaitPrompt(budgetMs?: number): Promise<string>
  awaitStderr(fragment: string, budgetMs?: number): Promise<void>
}

describe('issuer approval lifecycle', () => {
  let tempDir: string
  const running = new Set<ChildProcess>()

  beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), 'aukora-issuer-lifecycle-')) })

  const stopChild = async (child: ChildProcess): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) {
      running.delete(child)
      return
    }
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.removeListener('exit', onExit)
        if (error === undefined) resolve()
        else reject(error)
      }
      const onExit = (): void => { finish() }
      const timer = setTimeout(() => {
        finish(new Error(`issuer child did not exit within 5000ms after SIGKILL: pid=${String(child.pid)}`))
      }, 5_000)
      child.once('exit', onExit)
      if (child.exitCode !== null || child.signalCode !== null) {
        finish()
        return
      }
      if (!child.kill('SIGKILL') && child.exitCode === null && child.signalCode === null) {
        finish(new Error(`issuer child could not be signalled: pid=${String(child.pid)}`))
      }
    })
    running.delete(child)
  }

  afterEach(async () => {
    for (const child of [...running]) await stopChild(child)
    rmSync(tempDir, { recursive: true, force: true })
  })

  /**
   * Start an issuer from a copied tree with the given source substitutions.
   * Every substitution must change the source or the fixture refuses to run.
   */
  const startMutant = async (
    label: string,
    substitutions: ReadonlyArray<readonly [string, string]>,
    extraEnv: Record<string, string> = {},
  ): Promise<Mutant> => {
    const root = join(tempDir, label)
    cpSync(join(REPO_ROOT, 'aukora'), join(root, 'aukora'), { recursive: true })
    const entry = join(root, 'aukora', 'issuer', 'issuer.mjs')
    writeFileSync(entry, readFileSync(ISSUER_SRC, 'utf8'))
    let source = readFileSync(entry, 'utf8')
    for (const [from, to] of substitutions) {
      const next = source.replace(from, to)
      // A substitution that did not apply would leave the row testing nothing.
      expect(next, `substitution did not apply in ${label}: ${from.slice(0, 60)}`).not.toBe(source)
      source = next
    }
    // A copied issuer records the signing call synchronously. A stderr marker
    // would race the reply across independent descriptors.
    const signMarkerPath = join(tempDir, `${label}.sign-marker`)
    const marked = source.replace(
      'const signature = edSign(',
      `writeFileSync(${JSON.stringify(signMarkerPath)}, 'reached', { flag: 'a' }); const signature = edSign(`,
    )
    expect(marked).not.toBe(source)
    writeFileSync(entry, marked)

    const socketPath = join(tempDir, `${label}.sock`)
    const keyFile = join(tempDir, `${label}.pem`)
    const root_ = generateKeyPairSync('ed25519')
    writeFileSync(keyFile, root_.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), { mode: 0o600 })
    chmodSync(keyFile, 0o600)
    const child = spawn(process.execPath, [entry], {
      env: {
        ...process.env,
        AUKORA_ISSUER_SOCKET: socketPath,
        AUKORA_ISSUER_KEY_FILE: keyFile,
        AUKORA_EXPECTED_RECEIPT_KEY_ID: RECEIPT_KEY_ID,
        ...extraEnv,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    running.add(child)
    let stderr = ''
    let exited: { code: number | null; signal: string | null } | null = null
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.once('exit', (code, signal) => { exited = { code, signal } })

    const connects = (budgetMs = 1_000): Promise<boolean> => new Promise((resolve) => {
      const probe = createConnection(socketPath)
      let settled = false
      const finish = (connected: boolean): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        probe.destroy()
        resolve(connected)
      }
      const timer = setTimeout(() => { finish(false) }, budgetMs)
      probe.once('connect', () => { finish(true) })
      probe.once('error', () => { finish(false) })
    })
    // Readiness is a successful connection: a socket path exists before listen(2) returns.
    const readyBy = Date.now() + 10_000
    for (;;) {
      if (await connects()) break
      const dead = exited as { code: number | null; signal: string | null } | null
      if (dead !== null) throw new Error(`${label} exited before listening: code=${dead.code} signal=${dead.signal}; ${stderr.slice(0, 400)}`)
      if (Date.now() > readyBy) throw new Error(`${label} never listened; ${stderr.slice(0, 400)}`)
      await new Promise(resolve => setTimeout(resolve, 10))
    }

    const open = (request: unknown, budgetMs = 20_000): {
      readonly reply: Promise<Record<string, unknown>>
      disconnect(): void
    } => {
      const connection = createConnection(socketPath)
      const reply = new Promise<Record<string, unknown>>((resolve, reject) => {
        let buffer = ''
        let settled = false
        const settle = (fn: () => void): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          connection.destroy()
          fn()
        }
        const timer = setTimeout(() => {
          settle(() => { reject(new Error(`${label}: request exceeded ${budgetMs}ms`)) })
        }, budgetMs)
        connection.once('error', (error: Error) => { settle(() => { reject(error) }) })
        connection.once('close', () => {
          settle(() => { reject(new Error(`${label}: closed without a reply; ${stderr.slice(-300)}`)) })
        })
        connection.once('connect', () => { connection.write(`${JSON.stringify(request)}\n`) })
        connection.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf8')
          const cut = buffer.indexOf('\n')
          if (cut === -1) return
          try {
            const parsed = JSON.parse(buffer.slice(0, cut)) as Record<string, unknown>
            settle(() => { resolve(parsed) })
          } catch (error) {
            // Malformed JSON settles and tears down rather than stranding the row.
            settle(() => { reject(new Error(`${label}: malformed reply: ${String(error)}`)) })
          }
        })
      })
      return {
        reply,
        disconnect: () => { connection.destroy() },
      }
    }

    const mutant: Mutant = {
      child,
      socketPath,
      stderr: () => stderr,
      signingReached: () => existsSync(signMarkerPath),
      open,
      ask: (request, budgetMs) => open(request, budgetMs).reply,
      awaitPrompt: async (budgetMs = 5_000) => {
        const deadline = Date.now() + budgetMs
        const seen = new Set(stderr.match(/approve\? type "yes ([0-9a-f]{16})"/g) ?? [])
        for (;;) {
          const all = stderr.match(/approve\? type "yes ([0-9a-f]{16})"/g) ?? []
          const fresh = all.find(line => !seen.has(line))
          const challenge = fresh === undefined ? undefined : PROMPT.exec(fresh)?.[1]
          if (challenge !== undefined) return challenge
          if (Date.now() > deadline) throw new Error(`${label}: no prompt; ${stderr.slice(-300)}`)
          await new Promise(resolve => setTimeout(resolve, 10))
        }
      },
      awaitStderr: async (fragment, budgetMs = 5_000) => {
        const deadline = Date.now() + budgetMs
        while (!stderr.includes(fragment)) {
          if (Date.now() > deadline) throw new Error(`${label}: stderr did not contain ${JSON.stringify(fragment)}; ${stderr.slice(-300)}`)
          await new Promise(resolve => setTimeout(resolve, 10))
        }
      },
    }
    return mutant
  }

  it('refuses an unrecognised approval outcome without reaching the signing call', async () => {
    // The issuer stays alive so this row observes the approval-outcome branch
    // without depending on shutdown scheduling.
    const mutant = await startMutant('unknown-outcome', [[
      'async function askHumanForDigest(digest, signal) {',
      "async function askHumanForDigest(digest, signal) {\n  if (process.env.FIXTURE_UNKNOWN_OUTCOME === '1') return 'fixture-unrecognised-outcome'",
    ]], { FIXTURE_UNKNOWN_OUTCOME: '1' })
    const digest = 'a1'.repeat(32)
    expect(await mutant.ask({ op: 'admit', digest })).toEqual({ ok: true })
    expect(await mutant.ask({ op: 'authorize', digest }))
      .toEqual({ ok: false, reason: 'issuer:approval-outcome-unknown' })
    expect(mutant.signingReached()).toBe(false)
  }, 40_000)

  it('reports an expired admission distinctly, and does not confuse it with an unknown one', async () => {
    // PENDING_TTL_MS is shortened only in the copy. The production constant is a
    // security invariant and stays fixed.
    const mutant = await startMutant('expiry', [['const PENDING_TTL_MS = 120_000', 'const PENDING_TTL_MS = 300']])
    const digest = 'b2'.repeat(32)
    expect(await mutant.ask({ op: 'admit', digest })).toEqual({ ok: true })
    await new Promise(resolve => setTimeout(resolve, 600))
    expect(await mutant.ask({ op: 'authorize', digest }))
      .toEqual({ ok: false, reason: 'issuer:admission-expired' })
    expect(await mutant.ask({ op: 'authorize', digest: 'b3'.repeat(32) }))
      .toEqual({ ok: false, reason: 'issuer:digest-not-pending' })
    expect(mutant.signingReached()).toBe(false)
  }, 40_000)

  it('a prompt resolving late cannot delete an entry re-admitted under the same digest', async () => {
    const mutant = await startMutant('replacement', [['const PENDING_TTL_MS = 120_000', 'const PENDING_TTL_MS = 400']])
    const digest = 'c3'.repeat(32)
    expect(await mutant.ask({ op: 'admit', digest })).toEqual({ ok: true })
    // Hold the prompt open across the original admission's expiry.
    const stale = mutant.ask({ op: 'authorize', digest }).catch(() => ({ ok: false }))
    const challenge = await mutant.awaitPrompt()
    await new Promise(resolve => setTimeout(resolve, 700))
    // Another admission drives prunePending, dropping the expired original.
    await mutant.ask({ op: 'admit', digest: 'c4'.repeat(32) })
    expect(await mutant.ask({ op: 'admit', digest })).toEqual({ ok: true })
    // Resolve the original prompt as a denial. Denial consumes only the entry
    // that prompt reviewed; approval has a separate pre-signing identity check.
    expect(challenge).toMatch(/^[0-9a-f]{16}$/)
    mutant.child.stdin?.write('no\n')
    await stale
    // The replacement is authorized on its own fresh prompt.
    const authorizing = mutant.ask({ op: 'authorize', digest })
    const replacementChallenge = await mutant.awaitPrompt(10_000)
    expect(replacementChallenge).not.toBe(challenge)
    mutant.child.stdin?.write(`yes ${replacementChallenge}\n`)
    const authorized = await authorizing
    expect(authorized.ok).toBe(true)
  }, 60_000)

  it('keeps an admission claimable when its authorization carrier disconnects', async () => {
    const mutant = await startMutant('disconnect', [])
    const digest = 'd4'.repeat(32)
    expect(await mutant.ask({ op: 'admit', digest })).toEqual({ ok: true })
    const dropped = mutant.open({ op: 'authorize', digest })
    await mutant.awaitPrompt()
    dropped.disconnect()
    await expect(dropped.reply).rejects.toThrow(/closed without a reply/)
    await mutant.awaitStderr('issuer:approval-request-cancelled')

    const retry = mutant.open({ op: 'authorize', digest })
    const challenge = await mutant.awaitPrompt()
    mutant.child.stdin?.write(`yes ${challenge}\n`)
    expect((await retry.reply).ok).toBe(true)
  }, 40_000)
})
