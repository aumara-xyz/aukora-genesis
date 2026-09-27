// Slim shared issuer harness for scaffold-based memory transactions: spawns the
// real issuer process and auto-answers its digest-signing prompts (SCRIPTED).
// The canonical, fuller harness remains examples/headless-agent/tests/aukora-memory.snapshot.ts.
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const issuerEntry = fileURLToPath(new URL('../../../../aukora/issuer/issuer.mjs', import.meta.url))
const PROMPT = /\+- approve\? type "yes ([0-9a-f]{16})": /
const ARTIFACT_DIGEST = /approvalArtifactDigest: ([0-9a-f]{64})/g

export interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

export function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve })
  return { promise, resolve: resolvePromise }
}

export interface WebIssuerHarness {
  child: ChildProcess
  contact: Promise<'contact'>
  promptDigests: string[]
  stop(): Promise<void>
}

export async function startWebIssuer(socketPath: string, keyFile: string, receiptKeyId: string): Promise<WebIssuerHarness> {
  const promptDigests: string[] = []
  const contact = deferred<'contact'>()
  const child = spawn(process.execPath, [issuerEntry], {
    env: {
      AUKORA_ISSUER_SOCKET: socketPath,
      AUKORA_ISSUER_KEY_FILE: keyFile,
      AUKORA_EXPECTED_RECEIPT_KEY_ID: receiptKeyId,
    },
    stdio: ['pipe', 'ignore', 'pipe'],
  })
  // One accumulated buffer drives BOTH detectors, so a digest in one chunk and
  // its prompt in the next still pair correctly.
  let pending = ''
  let contacted = false
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
    pending += chunk.toString('utf8')
    if (!contacted && /approvalArtifactDigest: [0-9a-f]{64}/.test(pending)) {
      contacted = true
      contact.resolve('contact')
    }
    for (;;) {
      const prompt = PROMPT.exec(pending)
      if (prompt === null) break
      const consumed = prompt.index + prompt[0].length
      const digest = [...stderr.matchAll(ARTIFACT_DIGEST)].at(-1)?.[1]
      pending = pending.slice(consumed)
      if (digest === undefined) {
        child.stdin?.destroy(new Error('issuer prompt omitted its approval artifact digest'))
        return
      }
      promptDigests.push(digest)
      child.stdin?.write(`yes ${prompt[1]}\n`)
    }
  })
  const stop = async (): Promise<void> => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve()
      child.once('exit', () => resolve())
    })
  }
  return { child, contact: contact.promise, promptDigests, stop }
}
