import { generateKeyPairSync, sign } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildOperation, effectBody, operationDigest } from '../aukora/broker/operation.mjs'
import { definitionDigest, MEMORY_PUT } from '../aukora/broker/effect-definition.mjs'
import { createSubjectAuthorityContext } from '../aukora/broker/subject-authority.mjs'
import {
  AUTHORITY_EVIDENCE_DOMAIN,
  AUTHORITY_EVIDENCE_KEYS,
  createAuthorityEvidence,
  readAuthorityEvidence,
} from '../aukora/aura/authority-evidence.mjs'
import {
  createDelegationClaim,
  delegationClaimDigest,
  type DelegationClaimInputV1,
} from '../aukora/identity/delegation.mjs'
import {
  authorizationDigestV5,
  authorizationSignedMessageV5FromHex,
  inspectAuthorizationClaimsV5,
  REFUSE_V5,
  verifyGrantV5,
  verifyIssuedGrantV5,
  type ActionBudgetV5,
  type AuthorizationClaimsV5,
} from '../aukora/host-dsh/src/grant-v5.mjs'
import {
  authorizationSignedMessageFromHex,
  payloadDigest,
  receiptKeyIdForPublicKey,
} from '../aukora/host-dsh/src/grant.mjs'

const hex = (pair: string): string => pair.repeat(32)
const NOW_SECONDS = 5_000
const NOW = NOW_SECONDS * 1_000
const SUBJECT = `aukora:1:${hex('aa')}`
const CONTROL = hex('bb')
const ACTIVATION = hex('cc')
const AUDIENCE = 'broker:primary'
const RESOURCE = 'memory:key:notes.alpha'
const ARGS = Object.freeze({ key: 'notes.alpha', value: { text: 'subject-bound' } })

const parentInput = (): DelegationClaimInputV1 => ({
  subject: SUBJECT,
  kind: 'session',
  parentDigest: hex('10'),
  controlDigest: CONTROL,
  childKeyId: hex('11'),
  operations: ['memory.put', 'workspace.patch'],
  resources: [RESOURCE, 'memory:key:notes.beta'],
  audiences: [AUDIENCE, 'broker:recovery'],
  activationDigests: [ACTIVATION, hex('cd')],
  budgets: { calls: 10, bytes: 100_000, computeMs: 10_000, costMicrounits: 1_000 },
  notBefore: 4_000,
  expiresAt: 6_000,
  revocationId: 'revocation:session:1',
  nonce: hex('12'),
})

const agentInput = (parentDigest: string): DelegationClaimInputV1 => ({
  subject: SUBJECT,
  kind: 'agent',
  parentDigest,
  controlDigest: CONTROL,
  childKeyId: hex('20'),
  operations: ['memory.put'],
  resources: [RESOURCE],
  audiences: [AUDIENCE],
  activationDigests: [ACTIVATION],
  budgets: { calls: 3, bytes: 10_000, computeMs: 1_000, costMicrounits: 100 },
  notBefore: 4_500,
  expiresAt: 5_500,
  revocationId: 'revocation:agent:1',
  nonce: hex('21'),
})

interface FixtureOptions {
  parent?: DelegationClaimInputV1
  agent?: (parentDigest: string) => DelegationClaimInputV1
  now?: number
  exp?: number
  budget?: ActionBudgetV5
}

function fixture(options: FixtureOptions = {}) {
  const root = generateKeyPairSync('ed25519')
  const receipt = generateKeyPairSync('ed25519')
  const parent = createDelegationClaim(options.parent ?? parentInput())
  const agent = createDelegationClaim(
    options.agent?.(delegationClaimDigest(parent)) ?? agentInput(delegationClaimDigest(parent)),
  )
  const context = createSubjectAuthorityContext({
    subject: SUBJECT,
    activeControlDigest: CONTROL,
    activationDigest: ACTIVATION,
    audience: AUDIENCE,
    parentDelegationClaim: parent,
    delegationClaim: agent,
  })
  const exp = options.exp ?? 5_200
  const operation = buildOperation(ARGS, exp)
  const budget = options.budget ?? Object.freeze({
    calls: 1,
    bytes: Buffer.byteLength(effectBody(ARGS), 'utf8'),
    computeMs: 0,
    costMicrounits: 0,
  })
  const claims: AuthorizationClaimsV5 = {
    toolName: MEMORY_PUT,
    digest: payloadDigest(MEMORY_PUT, ARGS),
    nonce: 'subject-grant-nonce',
    exp,
    definitionId: definitionDigest(),
    operationDigest: operationDigest(operation),
    receiptKeyId: receiptKeyIdForPublicKey(receipt.publicKey),
    subject: context.subject,
    parentDigest: context.parentDigest,
    delegationDigest: context.delegationDigest,
    controlDigest: context.activeControlDigest,
    delegationKind: 'agent',
    activationDigest: context.activationDigest,
    audience: AUDIENCE,
    resource: RESOURCE,
    budget,
  }
  const signature = sign(
    null,
    authorizationSignedMessageV5FromHex(authorizationDigestV5(claims)),
    root.privateKey,
  ).toString('base64')
  const grant = Object.freeze({ ...claims, signature })
  const verify = {
    grant,
    toolName: MEMORY_PUT,
    args: ARGS,
    rootPublicKeyPem: root.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    now: options.now ?? NOW,
    expectedDefinitionId: definitionDigest(),
    expectedOperationDigest: claims.operationDigest,
    expectedReceiptKeyId: claims.receiptKeyId,
    parentDelegationClaim: parent,
    delegationClaim: agent,
    expectedSubject: SUBJECT,
    expectedControlDigest: CONTROL,
    expectedParentDigest: context.parentDigest,
    expectedActivationDigest: ACTIVATION,
    expectedAudience: AUDIENCE,
    expectedResource: RESOURCE,
    expectedBudget: budget,
  }
  return { root, receipt, parent, agent, context, claims, grant, verify }
}

describe('AUKORA subject-bound grant v5', () => {
  it('projects verifier evidence into a separate closed Aura-linked v1 record', () => {
    const subject = fixture()
    const verdict = verifyIssuedGrantV5(subject.verify)
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) throw new Error('positive control did not produce authority evidence')
    const record = createAuthorityEvidence({
      auraChainHash: hex('de'),
      authority: verdict.authority,
    })

    expect(Object.keys(record)).toEqual(AUTHORITY_EVIDENCE_KEYS)
    expect(record).toMatchObject({
      domain: AUTHORITY_EVIDENCE_DOMAIN,
      auraChainHash: hex('de'),
      grantDomain: 'aukora:tool-grant:v5',
      subject: SUBJECT,
      authorizationDigest: authorizationDigestV5(subject.claims),
    })
    expect(readAuthorityEvidence(record)).toEqual(record)
    expect(() => readAuthorityEvidence({ ...record, rider: true })).toThrow(/fields must be exactly/u)
    expect(() => readAuthorityEvidence({ ...record, domain: 'aukora:aura-record:v1' }))
      .toThrow(/authority evidence\.domain/u)
  })

  it('binds one agent delegation and reserves the grant once', () => {
    const subject = fixture()
    const seen = new Set<string>()

    expect(verifyIssuedGrantV5(subject.verify)).toMatchObject({
      ok: true,
      authority: {
        grantDomain: 'aukora:tool-grant:v5',
        subject: SUBJECT,
        parentDigest: subject.context.parentDigest,
        delegationDigest: subject.context.delegationDigest,
        activationDigest: ACTIVATION,
        resource: RESOURCE,
      },
    })
    expect(verifyGrantV5({ ...subject.verify, seenNonces: seen }).ok).toBe(true)
    expect(verifyGrantV5({ ...subject.verify, seenNonces: seen })).toEqual({
      ok: false,
      reason: 'grant:replayed',
    })
  })

  it.each([
    ['subject', 'expectedSubject', `aukora:1:${hex('ab')}`, REFUSE_V5.SUBJECT_MISMATCH],
    ['parent', 'expectedParentDigest', hex('31'), REFUSE_V5.PARENT_MISMATCH],
    ['control', 'expectedControlDigest', hex('32'), REFUSE_V5.CONTROL_MISMATCH],
    ['activation', 'expectedActivationDigest', hex('33'), REFUSE_V5.ACTIVATION_MISMATCH],
    ['audience', 'expectedAudience', 'broker:foreign', REFUSE_V5.AUDIENCE_MISMATCH],
    ['resource', 'expectedResource', 'memory:key:notes.beta', REFUSE_V5.RESOURCE_MISMATCH],
  ] as const)('refuses a mismatched %s expectation after a valid positive control', (
    _label,
    field,
    replacement,
    reason,
  ) => {
    const subject = fixture()

    expect(verifyIssuedGrantV5(subject.verify).ok).toBe(true)
    expect(verifyIssuedGrantV5({ ...subject.verify, [field]: replacement })).toEqual({ ok: false, reason })
  })

  it.each([
    [
      'operation',
      (parentDigest: string) => ({ ...agentInput(parentDigest), operations: [] }),
      REFUSE_V5.DELEGATION_OPERATION_DENIED,
    ],
    [
      'resource',
      (parentDigest: string) => ({ ...agentInput(parentDigest), resources: [] }),
      REFUSE_V5.DELEGATION_RESOURCE_DENIED,
    ],
    [
      'call budget',
      (parentDigest: string) => ({
        ...agentInput(parentDigest),
        budgets: { ...agentInput(parentDigest).budgets, calls: 0 },
      }),
      REFUSE_V5.BUDGET_CALLS_EXCEEDED,
    ],
  ] as const)('refuses an undelegated %s after a valid positive control', (_label, agent, reason) => {
    expect(verifyIssuedGrantV5(fixture().verify).ok).toBe(true)
    const denied = fixture({ agent })

    expect(verifyIssuedGrantV5(denied.verify)).toEqual({ ok: false, reason })
  })

  it.each([
    ['audience', (parentDigest: string) => ({ ...agentInput(parentDigest), audiences: [] })],
    ['activation', (parentDigest: string) => ({ ...agentInput(parentDigest), activationDigests: [] })],
  ] as const)('refuses an undelegated %s in the launch-owned context', (_label, agent) => {
    expect(verifyIssuedGrantV5(fixture().verify).ok).toBe(true)
    expect(() => fixture({ agent })).toThrow(/is not delegated/u)
  })

  it('refuses a claim before and after its time interval and a grant beyond it', () => {
    const future = fixture({ now: 4_400_000 })
    const expired = fixture({ now: 5_500_000 })
    const outlives = fixture({ exp: 5_501 })

    expect(verifyIssuedGrantV5(fixture().verify).ok).toBe(true)
    expect(verifyIssuedGrantV5(future.verify)).toEqual({
      ok: false,
      reason: REFUSE_V5.DELEGATION_NOT_YET_VALID,
    })
    expect(verifyIssuedGrantV5(expired.verify)).toEqual({
      ok: false,
      reason: REFUSE_V5.DELEGATION_EXPIRED,
    })
    expect(verifyIssuedGrantV5(outlives.verify)).toEqual({
      ok: false,
      reason: REFUSE_V5.GRANT_OUTLIVES_DELEGATION,
    })
  })

  it('does not accept a v4-domain signature over the v5 authorization digest', () => {
    const subject = fixture()
    const wrongSignature = sign(
      null,
      authorizationSignedMessageFromHex(authorizationDigestV5(subject.claims)),
      subject.root.privateKey,
    ).toString('base64')

    expect(verifyIssuedGrantV5({
      ...subject.verify,
      grant: { ...subject.grant, signature: wrongSignature },
    })).toEqual({ ok: false, reason: 'grant:signature-invalid' })
  })

  it('names a substituted delegation role before signature verification', () => {
    const subject = fixture()

    expect(inspectAuthorizationClaimsV5({
      ...subject.verify,
      claims: { ...subject.claims, delegationKind: 'session' },
    })).toEqual({ ok: false, reason: REFUSE_V5.ROLE_MISMATCH })
  })

  it('refuses riders, accessors, proxies, and a changed nested budget', () => {
    const subject = fixture()
    let invoked = false
    const accessor = { ...subject.grant }
    Object.defineProperty(accessor, 'subject', {
      enumerable: true,
      get() {
        invoked = true
        return SUBJECT
      },
    })

    expect(verifyIssuedGrantV5({ ...subject.verify, grant: { ...subject.grant, rider: true } }))
      .toEqual({ ok: false, reason: 'grant:malformed' })
    expect(verifyIssuedGrantV5({ ...subject.verify, grant: accessor }))
      .toEqual({ ok: false, reason: 'grant:malformed' })
    expect(invoked).toBe(false)
    expect(verifyIssuedGrantV5({ ...subject.verify, grant: new Proxy(subject.grant, {}) }))
      .toEqual({ ok: false, reason: 'grant:malformed' })
    expect(inspectAuthorizationClaimsV5({
      ...subject.verify,
      claims: { ...subject.claims, budget: { ...subject.claims.budget, bytes: 1 } },
    })).toEqual({ ok: false, reason: REFUSE_V5.BUDGET_MISMATCH })
  })

  it('detects removal of the delegated-operation check in copied production bytes', async () => {
    const denied = fixture({
      agent: parentDigest => ({ ...agentInput(parentDigest), operations: [] }),
    })
    const control = inspectAuthorizationClaimsV5({
      ...denied.verify,
      claims: denied.claims,
    })
    expect(control).toEqual({
      ok: false,
      reason: REFUSE_V5.DELEGATION_OPERATION_DENIED,
    })

    const temp = mkdtempSync(join(tmpdir(), 'aukora-v5-operation-mutant-'))
    try {
      const copiedAukora = join(temp, 'aukora')
      cpSync(join(import.meta.dirname, '..', 'aukora'), copiedAukora, { recursive: true })
      const mutantPath = join(copiedAukora, 'host-dsh', 'src', 'grant-v5.mjs')
      const source = readFileSync(mutantPath, 'utf8')
      const anchor = 'if (!delegation.operations.includes(params.toolName)) {'
      expect(source.split(anchor)).toHaveLength(2)
      const mutantSource = source.replace(anchor, 'if (false) {')
      expect(mutantSource).not.toBe(source)
      writeFileSync(mutantPath, mutantSource, 'utf8')
      const mutant = await import(`${pathToFileURL(mutantPath).href}?operation-guard-removed`) as {
        inspectAuthorizationClaimsV5: typeof inspectAuthorizationClaimsV5
      }
      const admitted = mutant.inspectAuthorizationClaimsV5({
        ...denied.verify,
        claims: denied.claims,
      })
      expect(admitted.ok).toBe(true)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })
})
