/**
 * Live-broker check-at-use of the persisted AUMLOK identity control head.
 *
 * Relationship under test: the broker re-reads its persisted identity-control
 * state from disk at every governed proposal (identityControlAdmits) rather
 * than trusting the head admitted at startup. A head swapped to a wrong
 * subject — or to a promoted, revoked control — must refuse the next
 * proposal with the named identity-control reason, and restoring the valid
 * head must admit again, all without a broker restart.
 *
 * Keyless: the control is generated in a throwaway directory via the standard
 * local-control fixture path; no external credentials, live services, or
 * approvals are involved. The probe stops at the first identity-control
 * gate, so no reviewer or issuer is ever contacted.
 */
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BROKER_REFUSE, spawnBroker } from '../aukora/broker/broker.mjs'
import { identityControlStatePath } from '../aukora/identity/broker-state.mjs'
import { identityControlDigest } from '../aukora/identity/control.mjs'
import { loadOrCreateLocalAumlokControl } from '../aukora/identity/local-control-store.mjs'
import { canonicalJSON } from '../aukora/kernel-seed/canonical-json.mjs'
import { createDeveloperAumlokAuthority } from '../aukora/supervisor/developer-aumlok.mjs'

const SYNTHETIC_ACTIVATION = 'cd'.repeat(32)
const PROBE_KEY = 'probe.identity-control-at-use'
const OTHER_SUBJECT = `aukora:1:${'7e'.repeat(32)}`
const POLL_TIMEOUT_MS = 10_000

interface BrokerFixture {
  readonly child: ReturnType<typeof spawnBroker> extends Promise<infer T> ? T : never
  readonly stateDir: string
  readonly socketPath: string
  readonly activeControl: Record<string, unknown>
  readonly rootDir: string
}

/** One newline-framed JSON exchange with the broker socket. */
function request(socketPath: string, value: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let pending = ''
    const timer = setTimeout(() => socket.destroy(new Error('probe request timeout')), 8_000)
    socket.once('error', reject)
    socket.once('connect', () => socket.write(`${JSON.stringify(value)}\n`))
    socket.on('data', (chunk) => {
      pending += chunk.toString()
      if (!pending.includes('\n')) return
      clearTimeout(timer)
      socket.destroy()
      resolve(JSON.parse(pending.split('\n')[0] as string) as Record<string, unknown>)
    })
  })
}

async function pollProposal(
  socketPath: string,
  proposalNamespace: string,
  proposalId: string,
): Promise<Record<string, unknown>> {
  const started = Date.now()
  for (;;) {
    const status = await request(socketPath, { op: 'proposal.status', proposalNamespace, proposalId })
    if ((status as { state?: string }).state !== 'PENDING') return status
    if (Date.now() - started > POLL_TIMEOUT_MS) throw new Error('proposal never left PENDING')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

/** Spawn one bound broker over a throwaway state directory and socket. */
async function startBroker(): Promise<BrokerFixture> {
  const rootDir = mkdtempSync(join(tmpdir(), 'aukora-identity-at-use-'))
  const controlDir = join(rootDir, 'control')
  const stateDir = join(rootDir, 'state')
  const socketPath = join(rootDir, 'broker.sock')
  const control = loadOrCreateLocalAumlokControl(controlDir)
  const authority = createDeveloperAumlokAuthority(control, { audience: 'broker:source-launch' })
  const expectation = Object.freeze({
    subject: (authority.subjectAuthorityExpectation as { subject: string }).subject,
    activeControlDigest: (authority.subjectAuthorityExpectation as { activeControlDigest: string }).activeControlDigest,
    activationDigest: SYNTHETIC_ACTIVATION,
    audience: 'broker:source-launch',
  })
  const child = await spawnBroker({
    socketPath,
    stateDir,
    rootPublicKeyPem: control.ed25519PublicKeyPem,
    activationDigest: SYNTHETIC_ACTIVATION,
    rootControlState: control.activeControl as never,
    subjectAuthorityExpectation: expectation,
    selectSubjectAuthority: async () => {
      throw new Error('selector must never be reached before the identity-control gate')
    },
    // The proposal route refuses to open without a declared issuer route and
    // a review callback; both are contacted only after the identity-control
    // gate this suite probes, so plain stubs keep the route open.
    issuerSocket: join(rootDir, 'issuer.sock'),
    review: async () => {
      throw new Error('review must never be reached before the identity-control gate')
    },
    timeoutMs: 20_000,
  })
  return { child, stateDir, socketPath, activeControl: control.activeControl as Record<string, unknown>, rootDir }
}

async function depositProbe(socketPath: string): Promise<Record<string, unknown>> {
  const opened = await request(socketPath, { op: 'proposal.open' })
  if ((opened as { ok?: boolean }).ok !== true) throw new Error(`proposal.open refused: ${JSON.stringify(opened)}`)
  const proposalNamespace = (opened as { proposalNamespace: string }).proposalNamespace
  const deposited = await request(socketPath, {
    op: 'proposal.deposit',
    proposalNamespace,
    callId: randomBytes(8).toString('hex'),
    toolName: 'memory.put',
    arguments: { key: PROBE_KEY, value: { probe: 'identity-control-at-use' } },
  })
  const proposalId = (deposited as { proposalId: string }).proposalId
  return pollProposal(socketPath, proposalNamespace, proposalId)
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) (cleanups.pop() as () => void)()
})

describe('persisted AUMLOK identity control at check-at-use (live broker)', () => {
  it('admits a valid control head at use, then refuses after the persisted head is swapped to a wrong subject', async () => {
    const fixture = await startBroker()
    cleanups.push(() => {
      fixture.child.kill()
      rmSync(fixture.rootDir, { recursive: true, force: true })
    })
    // Valid head: the proposal passes the identity-control gate and stops at
    // the next (unbound renderer) gate — never an identity-control refusal.
    await expect(depositProbe(fixture.socketPath)).resolves.toMatchObject({
      state: 'REFUSED',
      reason: BROKER_REFUSE.RENDERER_UNBOUND,
    })
    // Swap the persisted head to a different subject WITHOUT restarting.
    writeFileSync(
      identityControlStatePath(fixture.stateDir),
      `${canonicalJSON({ ...fixture.activeControl, subject: OTHER_SUBJECT })}\n`,
      { mode: 0o600 },
    )
    await expect(depositProbe(fixture.socketPath)).resolves.toMatchObject({
      state: 'REFUSED',
      reason: BROKER_REFUSE.IDENTITY_CONTROL_SUBJECT_MISMATCH,
    })
    // Restore the valid head: the same running broker admits again.
    writeFileSync(
      identityControlStatePath(fixture.stateDir),
      `${canonicalJSON(fixture.activeControl)}\n`,
      { mode: 0o600 },
    )
    await expect(depositProbe(fixture.socketPath)).resolves.toMatchObject({
      state: 'REFUSED',
      reason: BROKER_REFUSE.RENDERER_UNBOUND,
    })
  })

  it('refuses a promoted revoked head at use as a digest mismatch against the launch-pinned expectation', async () => {
    const fixture = await startBroker()
    cleanups.push(() => {
      fixture.child.kill()
      rmSync(fixture.rootDir, { recursive: true, force: true })
    })
    // A terminal revocation promotion produces a new head: epoch + 1, revoked,
    // chained to the predecessor digest. The launch-pinned expectation still
    // names the old digest, so at use the refusal is the digest mismatch; the
    // named REVOKED branch fires only when the pinned digest itself names a
    // revoked head, which startup refuses (covered by the broker-state suite).
    const revokedHead = {
      ...fixture.activeControl,
      epoch: 1,
      revoked: true,
      predecessorControlDigest: identityControlDigest(fixture.activeControl as never),
    }
    writeFileSync(
      identityControlStatePath(fixture.stateDir),
      `${canonicalJSON(revokedHead)}\n`,
      { mode: 0o600 },
    )
    await expect(depositProbe(fixture.socketPath)).resolves.toMatchObject({
      state: 'REFUSED',
      reason: BROKER_REFUSE.IDENTITY_CONTROL_DIGEST_MISMATCH,
    })
  })
})
