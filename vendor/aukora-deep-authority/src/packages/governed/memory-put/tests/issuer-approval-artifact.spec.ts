import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateKeyPairSync, verify as edVerify, type KeyObject } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createConnection, type Socket } from 'node:net'
import { fileURLToPath } from 'node:url'
import {
  approvalArtifactDigest,
  approvalSignedMessage,
  createApprovalArtifact,
  type ApprovalArtifact,
} from '@aukora/core/approval/artifact.mjs'
import { MAX_TTL_SECONDS } from '@aukora/core/host-dsh/src/grant.mjs'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const ISSUER_ENTRY = join(REPO_ROOT, 'aukora', 'issuer', 'issuer.mjs')
const PROMPT = /\+- approve\? type "yes ([0-9a-f]{16})": /

const ACTIVATION = 'a1'.repeat(32)
const RENDERER = 'b2'.repeat(32)

interface IssuerReply {
  ok: boolean
  reason?: string
  digest?: string
  signature?: string
}

/** A plain wire copy of a validated artifact, for targeted field tampering. */
const wire = (source: ApprovalArtifact): Record<string, unknown> => ({
  version: source.version,
  operationArguments: { key: source.operationArguments.key, value: source.operationArguments.value },
  operationCanonicalBytes: source.operationCanonicalBytes,
  operationDigest: source.operationDigest,
  semanticProjection: [...source.semanticProjection],
  definitionId: source.definitionId,
  activationDigest: source.activationDigest,
  occurrenceId: source.occurrenceId,
  expiry: source.expiry,
  rendererId: source.rendererId,
  oneUse: source.oneUse,
})

let occurrenceCounter = 0
const nextOccurrence = (): string => {
  occurrenceCounter += 1
  return occurrenceCounter.toString(16).padStart(32, '0')
}

const buildArtifact = (key: string, value: unknown = key): ApprovalArtifact => createApprovalArtifact({
  operationArguments: { key, value },
  expiry: Math.floor(Date.now() / 1000) + 300,
  activationDigest: ACTIVATION,
  occurrenceId: nextOccurrence(),
  rendererId: RENDERER,
})

/**
 * Copy the issuer and its authority modules into a temp tree, rewriting the
 * entry's relative imports to absolute repository paths so a sabotaged copy
 * runs against the real modules it does not itself mutate.
 */
function writeMutantIssuer(directory: string, sabotage: (source: string) => string): string {
  const original = readFileSync(ISSUER_ENTRY, 'utf8')
  const rebased = original.replace(
    /from '\.\.\/([^']+)'/g,
    (_match, rest: string) => `from '${join(REPO_ROOT, 'aukora', rest)}'`,
  ).replace(
    /from '\.\/([^']+)'/g,
    (_match, rest: string) => `from '${join(REPO_ROOT, 'aukora', 'issuer', rest)}'`,
  )
  const mutated = sabotage(rebased)
  if (mutated === rebased) throw new Error('sabotage did not change the issuer source')
  const target = join(directory, 'issuer-mutant.mjs')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, mutated, 'utf8')
  return target
}

/** Replace the prompt-level answer mapping so any answer reports approval. */
const BYPASS_PROMPT_MAPPING = (source: string): string => source.replace(
  'return settled.outcome === APPROVAL_OUTCOME.APPROVED ? APPROVAL.APPROVED : APPROVAL.DENIED',
  'return APPROVAL.APPROVED',
)

/** Remove the signing guard that requires the channel's own outcome to be signable. */
const REMOVE_SIGNING_GUARD = (source: string): string => source.replace(
  '  if (!signable) return { ok: false, reason: \'issuer:approval-outcome-unknown\' }',
  '  if (false && !signable) return { ok: false, reason: \'issuer:approval-outcome-unknown\' }',
)

/** Replace only the approval wall clock with a file-backed deterministic clock. */
const INJECT_APPROVAL_CLOCK = (source: string): string => source.replace(
  'function approvalTimeRefusal(expiry, now = Date.now()) {',
  "function approvalTimeRefusal(expiry, now = Number(readFileSync(process.env.AUKORA_TEST_APPROVAL_CLOCK_FILE ?? '', 'utf8'))) {",
)

describe('issuer approval artifact route', () => {
  let tempDir: string
  let socketPath: string
  let issuer: ChildProcess
  let rootPublicKey: KeyObject
  let stderr = ''
  let promptCount = 0
  const promptChallenges: string[] = []
  const promptWaiters: Array<{ count: number; resolve: () => void }> = []

  const startIssuer = async (entry: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<void> => {
    const keyFile = join(tempDir, 'root.pem')
    issuer = spawn(process.execPath, [entry], {
      env: {
        ...process.env,
        AUKORA_ISSUER_SOCKET: socketPath,
        AUKORA_ISSUER_KEY_FILE: keyFile,
        AUKORA_EXPECTED_RECEIPT_KEY_ID: '0'.repeat(64),
        ...extraEnv,
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
  }

  beforeEach(() => {
    stderr = ''
    promptCount = 0
    promptChallenges.length = 0
    promptWaiters.length = 0
    tempDir = mkdtempSync(join(tmpdir(), 'aukora-approval-artifact-'))
    socketPath = join(tempDir, 'issuer.sock')
    const keyFile = join(tempDir, 'root.pem')
    const root = generateKeyPairSync('ed25519')
    rootPublicKey = root.publicKey
    writeFileSync(keyFile, root.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), { mode: 0o600 })
    chmodSync(keyFile, 0o600)
  })

  afterEach(async () => {
    if (issuer !== undefined && issuer.exitCode === null) {
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

  function approveFrame(artifact: unknown, digest: string): string {
    return `${JSON.stringify({ op: 'approve-artifact', artifact, digest })}\n`
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

  /** Send one artifact, answer its prompt correctly, and return the reply. */
  async function approveHonestly(artifact: ApprovalArtifact, promptIndex = 1): Promise<IssuerReply> {
    const { reply } = startConnection(approveFrame(wire(artifact), approvalArtifactDigest(artifact)))
    await waitForPrompts(promptIndex)
    issuer.stdin?.write(`yes ${challengeForPrompt(promptIndex)}\n`)
    return reply
  }

  describe('at HEAD', () => {
    beforeEach(async () => { await startIssuer(ISSUER_ENTRY) })

    it('signs the digest of one exact approved artifact', async () => {
      const artifact = buildArtifact('notes.alpha')
      const digest = approvalArtifactDigest(artifact)
      const reply = await approveHonestly(artifact)
      expect(reply.ok).toBe(true)
      expect(reply.digest).toBe(digest)
      const valid = edVerify(
        null,
        approvalSignedMessage(digest),
        rootPublicKey,
        Buffer.from(String(reply.signature), 'base64'),
      )
      expect(valid).toBe(true)
    })

    it('renders every projection line of the artifact it signs', async () => {
      const artifact = buildArtifact('notes.alpha')
      await approveHonestly(artifact)
      for (const line of artifact.semanticProjection) expect(stderr).toContain(line)
      expect(stderr).toContain(`approvalArtifactDigest: ${approvalArtifactDigest(artifact)}`)
    })

    it('refuses a digest that names another artifact and never prompts', async () => {
      const shown = buildArtifact('notes.alpha')
      const other = buildArtifact('notes.beta')
      const { reply } = startConnection(approveFrame(wire(shown), approvalArtifactDigest(other)))
      await expect(reply).resolves.toMatchObject({ ok: false, reason: 'approval:artifact-digest-mismatch' })
      expect(promptCount).toBe(0)
    })

    it('refuses an artifact mutated by one byte after its digest was taken', async () => {
      const artifact = buildArtifact('notes.alpha')
      const digest = approvalArtifactDigest(artifact)
      const tampered = wire(artifact)
      tampered.activationDigest = 'a2'.repeat(32)
      const { reply } = startConnection(approveFrame(tampered, digest))
      await expect(reply).resolves.toMatchObject({ ok: false, reason: 'approval:artifact-digest-mismatch' })
      expect(promptCount).toBe(0)
    })

    it('refuses a substituted renderer and never prompts', async () => {
      const artifact = buildArtifact('notes.alpha')
      const digest = approvalArtifactDigest(artifact)
      const swapped = wire(artifact)
      swapped.rendererId = 'b3'.repeat(32)
      const { reply } = startConnection(approveFrame(swapped, digest))
      await expect(reply).resolves.toMatchObject({ ok: false, reason: 'approval:artifact-digest-mismatch' })
      expect(promptCount).toBe(0)
    })

    it('refuses a projection carrying an ANSI escape before any prompt', async () => {
      const artifact = buildArtifact('notes.alpha')
      const injected = wire(artifact)
      injected.semanticProjection = ['\u001b[2Ktool: memory.put', ...[...artifact.semanticProjection].slice(1)]
      const { reply } = startConnection(approveFrame(injected, approvalArtifactDigest(artifact)))
      const result = await reply
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('approval:')
      expect(promptCount).toBe(0)
    })

    it('returns the named refusal for a malformed artifact field', async () => {
      const artifact = buildArtifact('notes.alpha')
      const malformed = wire(artifact)
      malformed.expiry = 'later'
      const { reply } = startConnection(approveFrame(malformed, approvalArtifactDigest(artifact)))
      await expect(reply).resolves.toEqual({ ok: false, reason: 'approval:expiry-malformed' })
      expect(promptCount).toBe(0)
    })

    it('returns the named refusal for a malformed claimed digest', async () => {
      const artifact = buildArtifact('notes.alpha')
      const { reply } = startConnection(approveFrame(wire(artifact), 'not-a-digest'))
      await expect(reply).resolves.toEqual({ ok: false, reason: 'approval:digest-malformed' })
      expect(promptCount).toBe(0)
    })

    it('refuses an expired artifact before rendering a prompt', async () => {
      const artifact = createApprovalArtifact({
        operationArguments: { key: 'notes.expired', value: 'expired' },
        expiry: Math.floor(Date.now() / 1000) - 1,
        activationDigest: ACTIVATION,
        occurrenceId: nextOccurrence(),
        rendererId: RENDERER,
      })
      const { reply } = startConnection(approveFrame(wire(artifact), approvalArtifactDigest(artifact)))
      await expect(reply).resolves.toEqual({ ok: false, reason: 'approval:artifact-expired' })
      expect(promptCount).toBe(0)
    })

    it('refuses an artifact beyond the grant TTL ceiling before rendering a prompt', async () => {
      const artifact = createApprovalArtifact({
        operationArguments: { key: 'notes.unbounded', value: 'unbounded' },
        expiry: Math.floor(Date.now() / 1000) + MAX_TTL_SECONDS + 60,
        activationDigest: ACTIVATION,
        occurrenceId: nextOccurrence(),
        rendererId: RENDERER,
      })
      const { reply } = startConnection(approveFrame(wire(artifact), approvalArtifactDigest(artifact)))
      await expect(reply).resolves.toEqual({ ok: false, reason: 'approval:ttl-unbounded' })
      expect(promptCount).toBe(0)
    })

    it('refuses a wrong answer without signing', async () => {
      const artifact = buildArtifact('notes.alpha')
      const { reply } = startConnection(approveFrame(wire(artifact), approvalArtifactDigest(artifact)))
      await waitForPrompts(1)
      issuer.stdin?.write('yes not-the-challenge\n')
      const result = await reply
      expect(result).toMatchObject({ ok: false, reason: 'issuer:human-denied' })
      expect(result.signature).toBeUndefined()
    })

    it('shows one occurrence at a time and refuses a concurrent request', async () => {
      const first = buildArtifact('notes.alpha')
      const second = buildArtifact('notes.beta')
      const held = startConnection(approveFrame(wire(first), approvalArtifactDigest(first)))
      await waitForPrompts(1)
      const { reply: busy } = startConnection(approveFrame(wire(second), approvalArtifactDigest(second)))
      await expect(busy).resolves.toMatchObject({ ok: false, reason: 'issuer:approval-busy' })
      expect(promptCount).toBe(1)
      issuer.stdin?.write(`yes ${challengeForPrompt(1)}\n`)
      await expect(held.reply).resolves.toMatchObject({ ok: true })
    })

    it('cancels on disconnect and does not sign a later answer', async () => {
      const artifact = buildArtifact('notes.alpha')
      const abandoned = startConnection(approveFrame(wire(artifact), approvalArtifactDigest(artifact)))
      await waitForPrompts(1)
      const challenge = challengeForPrompt(1)
      abandoned.connection.destroy()
      await waitForStderr('issuer:approval-request-cancelled', () => stderr)
      issuer.stdin?.write(`yes ${challenge}\n`)
      await waitForStderr('issuer:input-without-active-prompt-discarded', () => stderr)
      expect(stderr).not.toContain('"signature"')
    })

    it('refuses an answer typed before the prompt exists', async () => {
      issuer.stdin?.write('yes premature\n')
      await waitForStderr('issuer:input-without-active-prompt-discarded', () => stderr)
      const artifact = buildArtifact('notes.alpha')
      await expect(approveHonestly(artifact)).resolves.toMatchObject({ ok: true })
    })

    it('refuses a request carrying an extra field', async () => {
      const artifact = buildArtifact('notes.alpha')
      const frame = `${JSON.stringify({
        op: 'approve-artifact',
        artifact: wire(artifact),
        digest: approvalArtifactDigest(artifact),
        rider: 1,
      })}\n`
      const { reply } = startConnection(frame)
      await expect(reply).resolves.toMatchObject({ ok: false, reason: 'issuer:approval-extra-fields' })
    })

    it('refuses a request missing its digest', async () => {
      const artifact = buildArtifact('notes.alpha')
      const frame = `${JSON.stringify({ op: 'approve-artifact', artifact: wire(artifact) })}\n`
      const { reply } = startConnection(frame)
      await expect(reply).resolves.toMatchObject({ ok: false, reason: 'issuer:approval-digest-missing' })
    })

    it('leaves the grant issuance route unchanged', async () => {
      const frame = `${JSON.stringify({
        op: 'issue',
        toolName: 'memory.put',
        arguments: { key: 'notes.legacy', value: 'legacy' },
        expiry: Math.floor(Date.now() / 1000) + 300,
      })}\n`
      const { reply } = startConnection(frame)
      await waitForPrompts(1)
      issuer.stdin?.write(`yes ${challengeForPrompt(1)}\n`)
      await expect(reply).resolves.toMatchObject({ ok: true })
    })
  })

  describe('signing-guard mutation arm', () => {
    it('applies both sabotages, so neither arm is a no-op against the real source', () => {
      const source = readFileSync(ISSUER_ENTRY, 'utf8')
      expect(BYPASS_PROMPT_MAPPING(source)).not.toBe(source)
      expect(REMOVE_SIGNING_GUARD(source)).not.toBe(source)
    })

    it('HEAD refuses a bypassed prompt mapping, and removing the guard signs it', async () => {
      // Arm 1: the prompt mapping is sabotaged so any answer reports approval.
      // The signing guard still reads the CHANNEL's own outcome, which is a
      // denial, so nothing is signed.
      const bypassDir = mkdtempSync(join(tmpdir(), 'aukora-approval-mutant-a-'))
      try {
        const entry = writeMutantIssuer(bypassDir, BYPASS_PROMPT_MAPPING)
        await startIssuer(entry)
        const artifact = buildArtifact('notes.alpha')
        const { reply } = startConnection(approveFrame(wire(artifact), approvalArtifactDigest(artifact)))
        await waitForPrompts(1)
        issuer.stdin?.write('yes not-the-challenge\n')
        const guarded = await reply
        expect(guarded).toMatchObject({ ok: false, reason: 'issuer:approval-outcome-unknown' })
        expect(guarded.signature).toBeUndefined()
      } finally {
        rmSync(bypassDir, { recursive: true, force: true })
      }

      // Arm 2: the same sabotage with the signing guard removed. The mutant
      // signs the exact request arm 1 refused, so the guard is what refused.
      if (issuer.exitCode === null) {
        issuer.kill()
        await new Promise(resolve => issuer.once('exit', resolve))
      }
      stderr = ''
      promptCount = 0
      promptChallenges.length = 0
      promptWaiters.length = 0
      socketPath = join(tempDir, 'issuer-mutant.sock')

      const unguardedDir = mkdtempSync(join(tmpdir(), 'aukora-approval-mutant-b-'))
      try {
        const entry = writeMutantIssuer(unguardedDir, source => REMOVE_SIGNING_GUARD(BYPASS_PROMPT_MAPPING(source)))
        await startIssuer(entry)
        const artifact = buildArtifact('notes.alpha')
        const { reply } = startConnection(approveFrame(wire(artifact), approvalArtifactDigest(artifact)))
        await waitForPrompts(1)
        issuer.stdin?.write('yes not-the-challenge\n')
        const unguarded = await reply
        expect(unguarded.ok).toBe(true)
        expect(typeof unguarded.signature).toBe('string')
      } finally {
        rmSync(unguardedDir, { recursive: true, force: true })
      }
    })
  })

  describe('signing-time expiry edge', () => {
    it('rechecks expiry after review against a deterministic advancing clock', async () => {
      const clockFile = join(tempDir, 'approval-clock.txt')
      const nowSeconds = 1_800_000_000
      const expiry = nowSeconds + 10
      writeFileSync(clockFile, String(nowSeconds * 1000), 'utf8')
      const mutantDir = mkdtempSync(join(tmpdir(), 'aukora-approval-clock-'))
      try {
        const entry = writeMutantIssuer(mutantDir, INJECT_APPROVAL_CLOCK)
        await startIssuer(entry, { AUKORA_TEST_APPROVAL_CLOCK_FILE: clockFile })
        const artifact = createApprovalArtifact({
          operationArguments: { key: 'notes.lapsed', value: 'lapsed' },
          expiry,
          activationDigest: ACTIVATION,
          occurrenceId: nextOccurrence(),
          rendererId: RENDERER,
        })
        const { reply } = startConnection(approveFrame(wire(artifact), approvalArtifactDigest(artifact)))
        await waitForPrompts(1)
        writeFileSync(clockFile, String(expiry * 1000), 'utf8')
        issuer.stdin?.write(`yes ${challengeForPrompt(1)}\n`)
        await expect(reply).resolves.toEqual({ ok: false, reason: 'approval:artifact-expired' })
      } finally {
        rmSync(mutantDir, { recursive: true, force: true })
      }
    })
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

function waitForStderr(text: string, read: () => string): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 2_000
    const inspect = (): void => {
      if (read().includes(text)) resolve()
      else if (Date.now() >= deadline) reject(new Error(`stderr did not contain ${JSON.stringify(text)}: ${read()}`))
      else setTimeout(inspect, 5)
    }
    inspect()
  })
}
