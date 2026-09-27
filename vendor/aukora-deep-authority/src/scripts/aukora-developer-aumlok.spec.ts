import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { BrokerAuthorityRequest } from '../aukora/broker/broker.mjs'
import { verifyDelegationAttenuation } from '../aukora/identity/delegation.mjs'
import {
  loadLocalAumlokControl,
  loadOrCreateLocalAumlokControl,
  type LocalAumlokControl,
} from '../aukora/identity/local-control-store.mjs'
import {
  createDeveloperAumlokAuthority,
  DEVELOPER_AUMLOK_PROJECTION_ENV,
  projectDeveloperAumlok,
  serializeDeveloperAumlokProjection,
} from '../aukora/supervisor/developer-aumlok.mjs'

const POSIX_AVAILABLE = typeof process.geteuid === 'function'
const temporaryDirectories: string[] = []
const ACTIVATION_DIGEST = '12'.repeat(32)
const AUDIENCE = 'broker:developer-web'
const projectionMutations: ReadonlyArray<readonly [
  string,
  (projection: Record<string, unknown>) => Record<string, unknown>,
]> = [
  ['an additional field', projection => ({ ...projection, path: '/private/controller' })],
  ['a malformed subject', projection => ({ ...projection, subject: 'aukora:owner' })],
  ['a negative epoch', projection => ({ ...projection, epoch: -1 })],
  ['a malformed control digest', projection => ({ ...projection, activeControlDigest: '12' })],
  ['a different grant domain', projection => ({ ...projection, grantDomain: 'aukora:tool-grant:v4' })],
  ['a different custody class', projection => ({ ...projection, custodyClass: 'human-exclusive' })],
]

function temporaryRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), 'aukora-developer-aumlok-'))
  temporaryDirectories.push(directory)
  return directory
}

function authorityRequest(expiresAt = Math.floor(Date.now() / 1000) + 600): Readonly<BrokerAuthorityRequest> {
  return Object.freeze({
    type: 'aukora:authority-request:v1',
    toolName: 'memory.put',
    selectionId: '23'.repeat(16),
    proposalId: 'proposal:developer-aumlok',
    operationDigest: '34'.repeat(32),
    artifactDigest: '45'.repeat(32),
    activationDigest: ACTIVATION_DIGEST,
    audience: AUDIENCE,
    resource: 'memory:key:kira:developer-aumlok',
    budget: Object.freeze({ calls: 1, bytes: 4_096, computeMs: 0, costMicrounits: 0 }),
    expiresAt,
  })
}

afterAll(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true })
})

describe.runIf(POSIX_AVAILABLE)('developer AUMLOK parent helper', () => {
  let control: Readonly<LocalAumlokControl>

  beforeAll(() => {
    control = loadOrCreateLocalAumlokControl(join(temporaryRoot(), 'control'))
  })

  it('projects one stable exact five-field public identity view', () => {
    const first = projectDeveloperAumlok(control)
    const loaded = loadLocalAumlokControl(dirname(control.path))
    const second = projectDeveloperAumlok(loaded)

    expect(Object.keys(first).toSorted()).toEqual([
      'activeControlDigest',
      'custodyClass',
      'epoch',
      'grantDomain',
      'subject',
    ])
    expect(first).toEqual(second)
    expect(first).toEqual({
      subject: control.subject,
      epoch: control.activeControl.epoch,
      activeControlDigest: control.activeControlDigest,
      grantDomain: 'aukora:tool-grant:v5',
      custodyClass: 'same-uid-posix-mode-only',
    })
    expect(JSON.stringify(first)).not.toMatch(/path|private|publicKey|claim|signature/iu)
    expect(DEVELOPER_AUMLOK_PROJECTION_ENV).toBe('AUKORA_WEB_AUMLOK_CONTROL_PROJECTION_JSON')
    expect(serializeDeveloperAumlokProjection(first)).toBe(JSON.stringify(first))
  })

  it.each(projectionMutations)('refuses to serialize %s', (_label, mutate) => {
    const candidate = mutate({ ...projectDeveloperAumlok(control) })
    expect(() => serializeDeveloperAumlokProjection(candidate)).toThrow()
  })

  it('selects fresh exact request-bound Agent authority beneath one wider session', async () => {
    const binding = createDeveloperAumlokAuthority(control, {
      audience: AUDIENCE,
    })
    const request = authorityRequest()
    const first = await binding.selectSubjectAuthority(request, new AbortController().signal)
    const second = await binding.selectSubjectAuthority(request, new AbortController().signal)

    expect(binding.subjectAuthorityExpectation).toEqual({
      subject: control.subject,
      activeControlDigest: control.activeControlDigest,
      audience: AUDIENCE,
    })
    expect(first).toMatchObject({
      subject: control.subject,
      activeControlDigest: control.activeControlDigest,
      activationDigest: request.activationDigest,
      audience: request.audience,
    })
    expect(first.delegationClaim).toMatchObject({
      kind: 'agent',
      subject: control.subject,
      controlDigest: control.activeControlDigest,
      operations: ['memory.put'],
      resources: [request.resource],
      audiences: [request.audience],
      activationDigests: [request.activationDigest],
      budgets: request.budget,
      expiresAt: request.expiresAt,
    })
    expect(first.parentDelegationClaim).toMatchObject({
      kind: 'session',
      subject: control.subject,
      controlDigest: control.activeControlDigest,
      operations: ['memory.put'],
      resources: [request.resource],
      audiences: [request.audience],
      activationDigests: [request.activationDigest],
      budgets: { ...request.budget, calls: 2 },
      expiresAt: request.expiresAt,
    })
    expect(verifyDelegationAttenuation(
      first.parentDelegationClaim,
      first.delegationClaim,
      { subject: control.subject, controlDigest: control.activeControlDigest },
    )).toMatchObject({ ok: true })
    expect(second.parentDigest).not.toBe(first.parentDigest)
    expect(second.delegationDigest).not.toBe(first.delegationDigest)
    expect(second.parentDelegationClaim.nonce).not.toBe(first.parentDelegationClaim.nonce)
    expect(second.delegationClaim.nonce).not.toBe(first.delegationClaim.nonce)
  })

  it('binds the activation from each request and refuses a different audience', async () => {
    const binding = createDeveloperAumlokAuthority(control, {
      audience: AUDIENCE,
    })
    const request = authorityRequest()
    const alternateActivation = '56'.repeat(32)
    const selected = await binding.selectSubjectAuthority(
      { ...request, activationDigest: alternateActivation },
      new AbortController().signal,
    )
    expect(selected.activationDigest).toBe(alternateActivation)
    expect(selected.delegationClaim.activationDigests).toEqual([alternateActivation])
    await expect(binding.selectSubjectAuthority(
      { ...request, audience: 'broker:other' },
      new AbortController().signal,
    )).rejects.toThrow('developer AUMLOK: authority request audience mismatch')
  })

  it('honors cancellation before returning generated claims', async () => {
    const binding = createDeveloperAumlokAuthority(control, {
      audience: AUDIENCE,
    })
    const controller = new AbortController()
    const reason = new Error('parent selector cancelled')
    const pending = binding.selectSubjectAuthority(authorityRequest(), controller.signal)
    controller.abort(reason)

    await expect(pending).rejects.toBe(reason)
  })
})
