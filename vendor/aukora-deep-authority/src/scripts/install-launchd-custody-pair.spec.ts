import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { basename, dirname, join, relative, resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { generateKeyPairSync } from 'node:crypto'

import { encodeSubjectAuthorityContext } from '../aukora/broker/subject-authority.mjs'
import { createDelegationClaim, delegationClaimDigest } from '../aukora/identity/delegation.mjs'
import { renderJobs } from './generate-launchd-jobs.mjs'
import { SUN_PATH_MAX_BYTES } from './launchd-review-transport.mjs'
import {
  CUSTODY_PAIR_FORMAT,
  CUSTODY_PAIR_REFUSE,
  acquireInstallerLock,
  assertInvocationTree,
  ensureJobsLoaded,
  executeCustodyPairPhases,
  gradeCustodyProbes,
  installedAuthorityManifestDigest,
  canonicalTerminalPublicKey,
  installedAuthorityFiles,
  expectedJobEntries,
  jobCommandMatches,
  launchInputs,
  requireActivationStatement,
  requireTerminalPublicKey,
  requireRootControlStateFile,
  parseDsclRecord,
  parseCustodyPairJson,
  parseIdentityList,
  parseNumericGroups,
  parseProcessList,
  runCustodyPair,
  stageAuthority,
  releaseInstallerLock,
  validateCustodyPairPlan,
} from './install-launchd-custody-pair.mjs'
import type {
  CustodyPairPhases,
  CustodyPairPlan,
  CustodyProbes,
  LaunchdJobLoadOperations,
} from './install-launchd-custody-pair.mjs'

const REPO_DIR = '/repo/aukora-deep'

// Scratch files exercise publication and re-observation; root ownership and
// ACL observations are simulated so this regression never provisions the host.
const custody = vi.hoisted(() => ({ root: '', wrongOwner: '', wrongGroup: '', publicAncestors: false }))
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return {
    ...fs,
    lstatSync: (...args: Parameters<typeof fs.lstatSync>) => {
      const state = fs.lstatSync(...args)
      const path = String(args[0])
      if (state !== undefined && custody.root !== '' && (path === custody.root || path.startsWith(`${custody.root}/`))) {
        Object.assign(state, { uid: path === custody.wrongOwner ? 501 : 0, gid: path === custody.wrongGroup ? 20 : 0 })
      }
      if (state !== undefined && custody.publicAncestors && (path === '/' || custody.root.startsWith(`${path}/`))) {
        Object.assign(state, { uid: 0, gid: 0, mode: (Number(state.mode) & ~0o777) | 0o755 })
      }
      return state
    },
    chownSync: (...args: Parameters<typeof fs.chownSync>) => {
      if (custody.root === '') fs.chownSync(...args)
    },
    fchownSync: (...args: Parameters<typeof fs.fchownSync>) => {
      if (custody.root === '') fs.fchownSync(...args)
    },
  }
})
vi.mock('./launchd-custody-acl.mjs', async (importOriginal) => {
  const acl = await importOriginal<typeof import('./launchd-custody-acl.mjs')>()
  return {
    ...acl,
    assertNoExtendedAcl: (path: string) => { if (custody.root === '') acl.assertNoExtendedAcl(path) },
    assertNoExtendedAclAncestors: (path: string) => { if (custody.root === '') acl.assertNoExtendedAclAncestors(path) },
  }
})

/** Exercise an implementation containing the operator's retained statement. */
function withInstalledActivation(operation: (plan: CustodyPairPlan) => void): void {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'aukora-installed-activation-')))
  custody.root = root
  const plan = {
    ...validPlan(),
    implementationRoot: join(root, installedAuthorityManifestDigest()),
    activationStatementFile: join(root, 'operator-activation.json'),
  }
  try {
    writeFileSync(plan.activationStatementFile, '{}', { mode: 0o644 })
    stageAuthority(plan, true)
    chmodSync(plan.implementationRoot, 0o755)
    const activation = join(plan.implementationRoot, 'activation.json')
    if (!existsSync(activation)) writeFileSync(activation, '{}', { mode: 0o444 })
    chmodSync(plan.implementationRoot, 0o555)
    operation(plan)
  } finally {
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (entry.isDirectory()) chmodSync(join(entry.parentPath, entry.name), 0o755)
    }
    rmSync(root, { recursive: true, force: true })
    Object.assign(custody, { root: '', wrongOwner: '', wrongGroup: '' })
  }
}

/** Return one plan that satisfies every plan-level prerequisite. */
function validPlan(): CustodyPairPlan {
  return {
    format: CUSTODY_PAIR_FORMAT,
    brokerLabel: 'com.aukora.broker',
    brokerUser: '_aukora_broker',
    brokerGroup: '_aukora_guest_route',
    brokerSocket: '/private/var/db/aukora/run/broker/broker.sock',
    brokerStateDir: '/private/var/db/aukora/broker',
    brokerUid: 60_001,
    brokerGid: 60_001,
    issuerLabel: 'com.aukora.issuer',
    issuerUser: '_aukora_issuer',
    issuerGroup: '_aukora_issuer_route',
    issuerSocket: '/private/var/db/aukora/run/issuer/issuer.sock',
    issuerStateDir: '/private/var/db/aukora/issuer',
    issuerKeyFile: '/private/var/db/aukora/issuer/root.pem',
    issuerUid: 60_002,
    issuerGid: 60_002,
    guestUser: '_aukora_guest',
    guestUid: 60_003,
    implementationRoot: '/private/var/db/aukora/implementation/sha256-abc123',
    nodeBin: '/usr/local/bin/node',
    nodeSha256: 'a'.repeat(64),
    launchDaemonDir: '/Library/LaunchDaemons',
    reviewSocket: '/private/var/db/aukora/run/broker/review.sock',
    reviewTerminalPublicKeyFile: '/private/var/db/aukora/review/terminal.pub',
    reviewServerId: 'b'.repeat(64),
    activationStatementFile: '/private/var/db/aukora/review/activation.json',
    activationDigest: 'c'.repeat(64),
    rendererId: 'd'.repeat(64),
  }
}

function memoryBundle() {
  const subject = `aukora:1:${'a'.repeat(64)}`
  const activationDigest = validPlan().activationDigest
  const claim = {
    subject, kind: 'session' as const, parentDigest: '1'.repeat(64),
    controlDigest: '2'.repeat(64), childKeyId: '3'.repeat(64),
    operations: ['memory.put'], resources: ['memory:key:test'], audiences: ['broker:test'],
    activationDigests: [activationDigest],
    budgets: { calls: 2, bytes: 4096, computeMs: 0, costMicrounits: 0 },
    notBefore: 1, expiresAt: 2_000_000_000, revocationId: 'session:test', nonce: '4'.repeat(64),
  }
  const parent = createDelegationClaim(claim)
  const agent = createDelegationClaim({
    ...claim, kind: 'agent', parentDigest: delegationClaimDigest(parent),
    budgets: { ...claim.budgets, calls: 1 },
  })
  return {
    kiraRecallPolicy: JSON.stringify({ subject, privacy: ['private', 'local'] }),
    subjectAuthority: encodeSubjectAuthorityContext({
      subject, activeControlDigest: claim.controlDigest, activationDigest,
      audience: 'broker:test', parentDelegationClaim: parent, delegationClaim: agent,
    }),
    rootControlStateFile: '/private/var/db/aukora/review/root-control.json',
  }
}


const ROOT_PEM = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()
const BROKER_PEM = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()

/** Return the argv one rendered launchd job will actually execute. */
function programArguments(plist: string): string[] {
  const block = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/u.exec(plist)?.[1] ?? ''
  return [...block.matchAll(/<string>([^<]*)<\/string>/gu)].map(match => match[1] as string)
}

/** Return the checked-in operator plan, validated. */
function examplePlan(): CustodyPairPlan {
  return validateCustodyPairPlan(JSON.parse(readFileSync(
    new URL('../ops/launchd/custody-pair.example.json', import.meta.url), 'utf8'),
  ), REPO_DIR)
}

/** Assert one operation refuses with an exact stable name. */
function refusesWith(operation: () => unknown, reason: string): void {
  expect(operation).toThrow(expect.objectContaining({ reason }))
}

/** Return the complete positive and negative probe control set. */
function validProbes(): CustodyProbes {
  return {
    guestBroker: { connected: true, errno: null },
    brokerIssuer: { connected: true, errno: null },
    guestIssuer: { connected: false, errno: 'EACCES' },
    issuerBroker: { connected: false, errno: 'EPERM' },
    issuerKey: { opened: true, errno: null },
    brokerKey: { opened: false, errno: 'EPERM' },
    guestKey: { opened: false, errno: 'EACCES' },
    brokerState: { opened: true, errno: null },
    guestState: { opened: false, errno: 'EPERM' },
    issuerState: { opened: false, errno: 'EACCES' },
  }
}

/** Return a complete fake phase set that records every sequencing edge. */
function fakePhases(events: string[], overrides: Partial<CustodyPairPhases> = {}): CustodyPairPhases {
  const phases: CustodyPairPhases = {
    ensureIdentities: (_plan, apply) => { events.push(`identities:${String(apply)}`); return { observed: true } },
    prepareManaged: (_plan, apply) => { events.push(`managed:${String(apply)}`); return { manifest: 'staged' } },
    observePreexisting: () => { events.push('preexisting'); return { expectedEntries: { closed: true } } },
    provisionIdentities: (_plan, apply) => {
      events.push(`principals:${String(apply)}`)
      return { brokerIdentity: { receiptKeyId: 'receipt-key' }, brokerKeyFile: '/broker/key' }
    },
    renderJobs: () => {
      events.push('render')
      return {
        jobs: { issuer: 'issuer-plist', broker: 'broker-plist' },
        paths: { issuer: '/issuer.plist', broker: '/broker.plist' },
      }
    },
    publishJob: (kind, _path, _content, apply) => {
      events.push(`publish:${kind}:${String(apply)}`)
      return { kind }
    },
    rollbackPublished: (publications) => { events.push(`rollback-published:${publications.length}`) },
    loadJobs: (_plan, _paths, apply) => { events.push(`load:${String(apply)}`); return ['issuer-loaded'] },
    observeActive: async () => { events.push('active'); return { held: true } },
    rollbackLoaded: (labels) => { events.push(`rollback-loaded:${labels.join(',')}`) },
  }
  return { ...phases, ...overrides }
}

describe('launchd custody-pair installation', () => {
  it('accepts and freezes the exact closed plan', () => {
    const plan = validPlan()
    const validated = validateCustodyPairPlan(plan, REPO_DIR)

    expect(validated).toEqual(plan)
    expect(validated).not.toBe(plan)
    expect(Object.isFrozen(validated)).toBe(true)
  })

  it('keeps the checked-in example on the current installed content address', () => {
    const sample = JSON.parse(readFileSync(
      new URL('../ops/launchd/custody-pair.example.json', import.meta.url),
      'utf8',
    )) as CustodyPairPlan

    expect(validateCustodyPairPlan(sample, REPO_DIR)).toEqual(sample)
    expect(basename(sample.implementationRoot)).toBe(installedAuthorityManifestDigest())
  })

  it('accepts the retained activation inventory on subsequent checks and applies without rewriting it', () => {
    withInstalledActivation((plan) => {
      const path = join(plan.implementationRoot, 'activation.json')
      const before = lstatSync(path)
      for (const apply of [false, true, false]) {
        expect(() => stageAuthority(plan, apply)).not.toThrow()
        expect(readFileSync(path, 'utf8')).toBe('{}')
        const after = lstatSync(path)
        expect([after.ino, after.mtimeMs, after.mode]).toEqual([before.ino, before.mtimeMs, before.mode])
      }
    })
  })

  it.each(['bytes', 'mode', 'owner', 'group', 'symlink', 'extra'])(
    'refuses an activation %s conflict without replacing bytes', (conflict) => {
      withInstalledActivation((plan) => {
        const path = join(plan.implementationRoot, 'activation.json')
        if (conflict === 'owner') custody.wrongOwner = path
        else if (conflict === 'group') custody.wrongGroup = path
        else if (conflict === 'mode' || conflict === 'bytes') {
          chmodSync(path, 0o644)
          if (conflict === 'bytes') {
            writeFileSync(path, 'conflicting statement')
            chmodSync(path, 0o444)
          }
        } else {
          chmodSync(plan.implementationRoot, 0o755)
          if (conflict === 'symlink') {
            rmSync(path)
            symlinkSync(plan.activationStatementFile, path)
          } else writeFileSync(join(plan.implementationRoot, 'unexpected.json'), '{}')
          chmodSync(plan.implementationRoot, 0o555)
        }
        const before = readFileSync(path)
        for (const apply of [false, true]) {
          refusesWith(() => stageAuthority(plan, apply), CUSTODY_PAIR_REFUSE.IMPLEMENTATION_CONFLICT)
          expect(readFileSync(path)).toEqual(before)
          expect(readFileSync(plan.activationStatementFile, 'utf8')).toBe('{}')
        }
      })
    },
  )

  it('refuses unknown, missing, accessor, and non-plain plans', () => {
    refusesWith(
      () => validateCustodyPairPlan({ ...validPlan(), rider: true }, REPO_DIR),
      CUSTODY_PAIR_REFUSE.FIELD_UNKNOWN,
    )
    const missing: Partial<CustodyPairPlan> = validPlan()
    delete missing.issuerKeyFile
    refusesWith(
      () => validateCustodyPairPlan(missing, REPO_DIR),
      CUSTODY_PAIR_REFUSE.FIELD_MISSING,
    )
    const accessor = validPlan()
    let reads = 0
    Object.defineProperty(accessor, 'brokerLabel', {
      enumerable: true,
      get: () => { reads += 1; return 'com.aukora.broker' },
    })
    refusesWith(
      () => validateCustodyPairPlan(accessor, REPO_DIR),
      CUSTODY_PAIR_REFUSE.INPUTS_NOT_PLAIN,
    )
    expect(reads).toBe(0)
    refusesWith(
      () => validateCustodyPairPlan(Object.setPrototypeOf(validPlan(), { inherited: true }), REPO_DIR),
      CUSTODY_PAIR_REFUSE.INPUTS_NOT_PLAIN,
    )
    refusesWith(
      () => validateCustodyPairPlan([validPlan()], REPO_DIR),
      CUSTODY_PAIR_REFUSE.INPUTS_NOT_PLAIN,
    )
  })

  it('refuses duplicate JSON field spellings before plan validation', () => {
    refusesWith(
      () => parseCustodyPairJson('{"format":"one","\\u0066ormat":"two"}'),
      CUSTODY_PAIR_REFUSE.FIELD_DUPLICATE,
    )
    expect(parseCustodyPairJson('{"format":"one","brokerLabel":"two"}')).toEqual({
      format: 'one',
      brokerLabel: 'two',
    })
  })

  it('refuses relative, non-normalized, whitespace, unmanaged, and checkout paths', () => {
    const cases: Array<[keyof CustodyPairPlan, string, string]> = [
      ['nodeBin', 'usr/local/bin/node', CUSTODY_PAIR_REFUSE.FIELD_INVALID],
      ['nodeBin', '/usr/local/../bin/node', CUSTODY_PAIR_REFUSE.FIELD_INVALID],
      ['nodeBin', '/usr/local/bin/node copy', CUSTODY_PAIR_REFUSE.FIELD_INVALID],
      ['brokerStateDir', '/tmp/aukora/broker', CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED],
      ['brokerStateDir', '/private/var/db/aukora/nested/broker', CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED],
      ['brokerSocket', '/tmp/aukora/broker.sock', CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED],
      ['brokerSocket', '/private/var/db/aukora/run/nested/broker/broker.sock', CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED],
      ['implementationRoot', `${REPO_DIR}/installed`, CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED],
      ['launchDaemonDir', '/private/var/db/aukora/jobs', CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED],
    ]
    for (const [field, value, reason] of cases) {
      const plan = validPlan()
      Object.assign(plan, { [field]: value })
      refusesWith(() => validateCustodyPairPlan(plan, REPO_DIR), reason)
    }
    const checkout = validPlan()
    checkout.implementationRoot = '/private/var/db/aukora/implementation/checkout/installed'
    refusesWith(
      () => validateCustodyPairPlan(
        checkout,
        '/private/var/db/aukora/implementation/checkout',
      ),
      CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED,
    )
  })

  it('requires safe distinct launchd labels and service names', () => {
    for (const [field, value] of [
      ['brokerLabel', '../com.aukora.broker'],
      ['brokerLabel', 'com..aukora.broker'],
      ['brokerUser', 'aukora-broker'],
      ['guestUser', '_aukora guest'],
    ] as const) {
      const plan = validPlan()
      plan[field] = value
      refusesWith(
        () => validateCustodyPairPlan(plan, REPO_DIR),
        CUSTODY_PAIR_REFUSE.FIELD_INVALID,
      )
    }
    const duplicateLabel = validPlan()
    duplicateLabel.issuerLabel = duplicateLabel.brokerLabel
    refusesWith(
      () => validateCustodyPairPlan(duplicateLabel, REPO_DIR),
      CUSTODY_PAIR_REFUSE.FIELD_INVALID,
    )
  })

  it('refuses account-name, uid, route-group-name, and gid collisions', () => {
    for (const mutate of [
      (plan: CustodyPairPlan) => { plan.guestUser = plan.brokerUser },
      (plan: CustodyPairPlan) => { plan.guestUid = plan.brokerUid },
      (plan: CustodyPairPlan) => { plan.issuerGroup = plan.brokerGroup },
      (plan: CustodyPairPlan) => { plan.issuerGid = plan.brokerGid },
    ]) {
      const plan = validPlan()
      mutate(plan)
      refusesWith(
        () => validateCustodyPairPlan(plan, REPO_DIR),
        CUSTODY_PAIR_REFUSE.ID_COLLISION,
      )
    }
  })

  it('parses exact identity listings and refuses malformed or duplicate rows', () => {
    expect(parseIdentityList('_aukora_broker 60001\n_aukora_issuer 60002\n', 'user')).toEqual(
      new Map([['_aukora_broker', 60_001], ['_aukora_issuer', 60_002]]),
    )
    for (const text of [
      '_aukora_broker 60001 rider\n',
      '_aukora_broker 60001\n_aukora_broker 60002\n',
      `_aukora_broker ${Number.MAX_SAFE_INTEGER + 1}\n`,
      `nobody -${Number.MAX_SAFE_INTEGER + 1}\n`,
      'nobody --2\n',
      'nobody -2 rider\n',
    ]) {
      refusesWith(
        () => parseIdentityList(text, 'user'),
        CUSTODY_PAIR_REFUSE.HOST_OBSERVATION_FAILED,
      )
    }
  })

  it.each(['group', 'user', 'user primary-group'])('preserves signed built-in IDs in the %s inventory', (kind) => {
    expect(parseIdentityList('nobody                           -2\nnogroup                          -1\nstaff                            20\n', kind)).toEqual(
      new Map([['nobody', -2], ['nogroup', -1], ['staff', 20]]),
    )
    expect(parseIdentityList('nobody -2\n_aukora_broker 601\n', kind).get('_aukora_broker')).toBe(601)
    refusesWith(
      () => parseIdentityList('nobody -2\nnobody -1\n', kind),
      CUSTODY_PAIR_REFUSE.HOST_OBSERVATION_FAILED,
    )
  })

  it('parses exact dscl attributes and refuses omissions and repeats', () => {
    const required = ['UniqueID', 'PrimaryGroupID']
    expect(parseDsclRecord('UniqueID: 60001\nPrimaryGroupID: 60001\n', required)).toEqual(
      new Map([['UniqueID', '60001'], ['PrimaryGroupID', '60001']]),
    )
    refusesWith(
      () => parseDsclRecord('UniqueID: 60001\n', required),
      CUSTODY_PAIR_REFUSE.HOST_OBSERVATION_FAILED,
    )
    refusesWith(
      () => parseDsclRecord('UniqueID: 60001\nUniqueID: 60002\nPrimaryGroupID: 60001\n', required),
      CUSTODY_PAIR_REFUSE.HOST_OBSERVATION_FAILED,
    )
    refusesWith(
      () => parseDsclRecord('UniqueID 60001\nPrimaryGroupID: 60001\n', required),
      CUSTODY_PAIR_REFUSE.HOST_OBSERVATION_FAILED,
    )
  })

  it('reads native IsHidden without inventing absent optional dscl attributes', () => {
    expect(parseDsclRecord('dsAttrTypeNative:IsHidden: 1\nUniqueID: 601\n', ['IsHidden', 'UniqueID'])).toEqual(
      new Map([['IsHidden', '1'], ['UniqueID', '601']]),
    )
    expect(parseDsclRecord('PrimaryGroupID: 601\n', ['PrimaryGroupID'])).toEqual(
      new Map([['PrimaryGroupID', '601']]),
    )
  })

  it('refuses missing required dscl fields and conflicting presence or native aliases', () => {
    for (const text of [
      'No such key: IsHidden\n',
      'No such key: IsHidden\ndsAttrTypeNative:IsHidden: 1\n',
      'dsAttrTypeNative:IsHidden: 1\nNo such key: IsHidden\n',
      'IsHidden: 1\ndsAttrTypeNative:IsHidden: 1\n',
      'dsAttrTypeNative:IsHidden: 1\nIsHidden: 1\n',
      'IsHidden: 1\nNo such key: GroupMembers\nNo such key: GroupMembers\n',
      'IsHidden: 1\ndsAttrTypeNative:AuthenticationAuthority: unexpected\n',
      'IsHidden: 1\nNo such key: GroupMembers extra\n',
    ]) {
      refusesWith(() => parseDsclRecord(text, ['IsHidden']), CUSTODY_PAIR_REFUSE.HOST_OBSERVATION_FAILED)
    }
  })

  it('parses exact numeric groups and refuses malformed output', () => {
    expect(parseNumericGroups('60001 60002\n')).toEqual(new Set([60_001, 60_002]))
    for (const text of ['', '60001  60002', '60001 group', '-1 60001']) {
      refusesWith(
        () => parseNumericGroups(text),
        CUSTODY_PAIR_REFUSE.HOST_OBSERVATION_FAILED,
      )
    }
  })

  it('parses process ownership rows and refuses malformed identities', () => {
    expect(parseProcessList('  123  601  601 /usr/local/bin/node /authority/broker.mjs\n')).toEqual([
      { pid: 123, uid: 601, gid: 601, command: '/usr/local/bin/node /authority/broker.mjs' },
    ])
    for (const text of [
      '123 601 command-without-gid\n',
      'pid 601 601 /usr/local/bin/node\n',
      `123 ${Number.MAX_SAFE_INTEGER + 1} 601 /usr/local/bin/node\n`,
    ]) {
      refusesWith(
        () => parseProcessList(text),
        CUSTODY_PAIR_REFUSE.HOST_OBSERVATION_FAILED,
      )
    }
  })

  it('accepts only EACCES or EPERM as observed deprivation', () => {
    expect(gradeCustodyProbes(validProbes())).toEqual({
      brokerToIssuer: 'CONNECTED',
      guestToBroker: 'CONNECTED',
      issuerToBroker: 'EPERM',
      guestToIssuer: 'EACCES',
      brokerToIssuerKey: 'EPERM',
      guestToIssuerKey: 'EACCES',
      guestToBrokerState: 'EPERM',
      issuerToBrokerState: 'EACCES',
    })
    const absentIssuer = validProbes()
    absentIssuer.guestIssuer = { connected: false, errno: 'ENOENT' }
    refusesWith(
      () => gradeCustodyProbes(absentIssuer),
      CUSTODY_PAIR_REFUSE.GUEST_REACHED_ISSUER,
    )
    const absentSecret = validProbes()
    absentSecret.guestKey = { opened: false, errno: 'ENOENT' }
    refusesWith(
      () => gradeCustodyProbes(absentSecret),
      CUSTODY_PAIR_REFUSE.GUEST_REACHED_SECRET,
    )
  })

  it('requires both allowed routes and both owning-principal file controls', () => {
    for (const mutate of [
      (probes: CustodyProbes) => { probes.guestBroker = { connected: false, errno: 'EACCES' } },
      (probes: CustodyProbes) => { probes.brokerIssuer = { connected: false, errno: 'EACCES' } },
      (probes: CustodyProbes) => { probes.issuerKey = { opened: false, errno: 'EACCES' } },
      (probes: CustodyProbes) => { probes.brokerState = { opened: false, errno: 'EACCES' } },
    ]) {
      const probes = validProbes()
      mutate(probes)
      refusesWith(
        () => gradeCustodyProbes(probes),
        CUSTODY_PAIR_REFUSE.POSITIVE_CONTROL_FAILED,
      )
    }
  })

  it('refuses unsupported platforms and non-root callers before host observation', async () => {
    await expect(runCustodyPair(validPlan(), {
      apply: undefined as unknown as boolean,
      platform: 'darwin',
      euid: 0,
    })).rejects.toMatchObject({ reason: CUSTODY_PAIR_REFUSE.FIELD_INVALID })
    await expect(runCustodyPair(validPlan(), {
      apply: false,
      platform: 'linux',
      euid: 0,
    })).rejects.toMatchObject({ reason: CUSTODY_PAIR_REFUSE.PLATFORM_UNSUPPORTED })
    await expect(runCustodyPair(validPlan(), {
      apply: false,
      platform: 'darwin',
      euid: 501,
    })).rejects.toMatchObject({ reason: CUSTODY_PAIR_REFUSE.ROOT_REQUIRED })
  })

  it('serializes installers and releases only the exact lock custody', () => {
    const root = mkdtempSync(join(tmpdir(), 'aukora-custody-lock-'))
    try {
      const owner = lstatSync(root)
      const path = join(root, '.install.lock')
      const lock = acquireInstallerLock(path, { uid: owner.uid, gid: owner.gid })
      expect(lstatSync(path).mode & 0o777).toBe(0o600)
      refusesWith(
        () => acquireInstallerLock(path, { uid: owner.uid, gid: owner.gid }),
        CUSTODY_PAIR_REFUSE.INSTALL_ACTIVE,
      )
      releaseInstallerLock(lock)
      expect(existsSync(path)).toBe(false)

      const changed = acquireInstallerLock(path, { uid: owner.uid, gid: owner.gid })
      chmodSync(path, 0o644)
      refusesWith(
        () => {
          releaseInstallerLock(changed)
        },
        CUSTODY_PAIR_REFUSE.INSTALL_LOCK_INDETERMINATE,
      )
      expect(existsSync(path)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('executes the coarse production order without minting a status claim', async () => {
    const events: string[] = []
    const result = await executeCustodyPairPhases(validPlan(), false, fakePhases(events))

    expect(events).toEqual([
      'identities:false',
      'preexisting',
      'managed:false',
      'principals:false',
      'preexisting',
      'render',
      'publish:issuer:false',
      'publish:broker:false',
      'load:false',
      'active',
    ])
    expect(result).not.toHaveProperty('status')
    expect(result).toMatchObject({ receiptKeyId: 'receipt-key' })
  })

  it('rolls back only the first publication when broker publication fails', async () => {
    const events: string[] = []
    const failure = new Error('broker publication failed')
    const phases = fakePhases(events, {
      publishJob: (kind, _path, _content, apply) => {
        events.push(`publish:${kind}:${String(apply)}`)
        if (kind === 'broker') throw failure
        return { kind }
      },
      rollbackPublished: (publications, cause) => {
        events.push(`rollback-published:${publications.length}:${String(cause === failure)}`)
      },
    })

    await expect(executeCustodyPairPhases(validPlan(), true, phases)).rejects.toBe(failure)
    expect(events).toContain('publish:issuer:true')
    expect(events).toContain('publish:broker:true')
    expect(events).toContain('rollback-published:1:true')
    expect(events.some(event => event.startsWith('load:'))).toBe(false)
  })

  it('rolls back only labels loaded by an applying observation that fails', async () => {
    for (const apply of [true, false]) {
      const events: string[] = []
      const failure = new Error('active observation failed')
      const phases = fakePhases(events, {
        loadJobs: () => ['issuer-loaded'],
        observeActive: async () => { throw failure },
      })
      await expect(executeCustodyPairPhases(validPlan(), apply, phases)).rejects.toBe(failure)
      expect(events.includes('rollback-loaded:issuer-loaded')).toBe(apply)
    }
  })

  it('loads issuer before broker and re-observes indeterminate bootstrap outcomes', () => {
    const calls: string[] = []
    const rollbacks: string[][] = []
    const operations: LaunchdJobLoadOperations = {
      observe: (label) => { calls.push(`observe:${label}`); return null },
      bootstrap: (label) => {
        calls.push(`bootstrap:${label}`)
        return label === 'com.aukora.issuer'
          ? { status: 5, stderr: 'ambiguous' }
          : { status: 0, stderr: '' }
      },
      read: (label) => { calls.push(`read:${label}`); return 'loaded' },
      rollback: (labels) => { rollbacks.push([...labels]) },
    }

    expect(() => ensureJobsLoaded(validPlan(), {
      issuer: '/issuer.plist',
      broker: '/broker.plist',
    }, true, operations)).toThrow(expect.objectContaining({ reason: CUSTODY_PAIR_REFUSE.PARTIAL_STATE }))
    expect(calls).toEqual([
      'observe:com.aukora.issuer',
      'bootstrap:com.aukora.issuer',
      'read:com.aukora.issuer',
    ])
    expect(rollbacks).toEqual([[]])
  })

  it('returns only labels loaded by this invocation', () => {
    const calls: string[] = []
    const operations: LaunchdJobLoadOperations = {
      observe: (label) => {
        calls.push(`observe:${label}`)
        return label === 'com.aukora.issuer' ? { preexisting: true } : null
      },
      bootstrap: (label) => { calls.push(`bootstrap:${label}`); return { status: 0, stderr: '' } },
      read: () => null,
      rollback: (labels) => { calls.push(`rollback:${labels.join(',')}`) },
    }

    expect(ensureJobsLoaded(validPlan(), {
      issuer: '/issuer.plist',
      broker: '/broker.plist',
    }, true, operations)).toEqual(['com.aukora.broker'])
    expect(calls).toEqual([
      'observe:com.aukora.issuer',
      'observe:com.aukora.broker',
      'bootstrap:com.aukora.broker',
    ])
  })

  it('bootstraps both absent labels issuer-first', () => {
    const calls: string[] = []
    const operations: LaunchdJobLoadOperations = {
      observe: (label) => { calls.push(`observe:${label}`); return null },
      bootstrap: (label) => { calls.push(`bootstrap:${label}`); return { status: 0, stderr: '' } },
      read: () => null,
      rollback: (labels) => { calls.push(`rollback:${labels.join(',')}`) },
    }

    expect(ensureJobsLoaded(validPlan(), {
      issuer: '/issuer.plist',
      broker: '/broker.plist',
    }, true, operations)).toEqual(['com.aukora.issuer', 'com.aukora.broker'])
    expect(calls).toEqual([
      'observe:com.aukora.issuer',
      'bootstrap:com.aukora.issuer',
      'observe:com.aukora.broker',
      'bootstrap:com.aukora.broker',
    ])
  })

  it('reports indeterminate bootstrap observation without unloading an unowned label', () => {
    const rollbacks: string[][] = []
    const operations: LaunchdJobLoadOperations = {
      observe: () => null,
      bootstrap: () => ({ status: 5, stderr: 'ambiguous' }),
      read: () => { throw new Error('launchd observation failed') },
      rollback: (labels) => { rollbacks.push([...labels]) },
    }

    expect(() => ensureJobsLoaded(validPlan(), {
      issuer: '/issuer.plist',
      broker: '/broker.plist',
    }, true, operations)).toThrow(expect.objectContaining({ reason: CUSTODY_PAIR_REFUSE.PARTIAL_STATE }))
    expect(rollbacks).toEqual([[]])
  })

  it('stages every authority path once when entry imports are also graph members', () => {
    const files = installedAuthorityFiles()
    const paths = files.map(file => file.path)
    expect(paths).toHaveLength(new Set(paths).size)
    const statement = files.filter(file => file.path === 'aukora/activation/statement.mjs')
    expect(statement).toHaveLength(1)
    expect(statement[0]?.bytes).toEqual(readFileSync(new URL('../aukora/activation/statement.mjs', import.meta.url)))
  })

  it('stages the broker entry\'s entire relative-import closure', () => {
    // The installed daemon runs from the implementation root with no developer
    // checkout on disk. Any relative import reachable from the entry that is
    // not staged would fail to resolve there, so the closure is the invariant,
    // not the three files the entry itself names.
    const checkout = fileURLToPath(new URL('..', import.meta.url))
    const staged = new Set(installedAuthorityFiles().map(file => file.path))
    const closure = new Set<string>()
    const pending = [join(checkout, 'scripts', 'launchd-broker-entry.mjs')]
    while (pending.length > 0) {
      const file = pending.pop() as string
      const path = relative(checkout, file)
      if (closure.has(path)) continue
      closure.add(path)
      for (const match of readFileSync(file, 'utf8').matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        pending.push(resolve(dirname(file), match[1] as string))
      }
    }
    expect(closure.size).toBeGreaterThan(3)
    expect([...closure].filter(path => !staged.has(path))).toEqual([])
  })

  it('renders the broker job through the real installer-to-generator connection', () => {
    // The installer's phase seam is injectable and this suite fakes renderJobs,
    // so a plan field the generator requires can go missing with every test
    // still green. This drives the checked-in operator plan through the real
    // launchInputs into the real generator.
    const plan = examplePlan()
    const jobs = renderJobs(launchInputs(plan, ROOT_PEM, BROKER_PEM))
    expect(jobs.broker).toContain(`<string>${plan.reviewSocket}</string>`)
    expect(jobs.broker).toContain(`<string>${plan.reviewTerminalPublicKeyFile}</string>`)
    expect(jobs.broker).toContain(`<string>${plan.reviewServerId}</string>`)
  })

  it('carries an optional operator transport only into the issuer job', () => {
    const bundle = {
      issuerApprovalSocket: '/private/var/db/aukora/review/issuer-approval.sock',
      issuerApprovalSocketUid: '501',
    }
    const plan = validateCustodyPairPlan({ ...validPlan(), ...bundle }, REPO_DIR)
    const jobs = renderJobs(launchInputs(plan, ROOT_PEM, BROKER_PEM))
    expect(jobs.issuer).toContain(`<string>${bundle.issuerApprovalSocket}</string>`)
    expect(jobs.issuer).toContain('<string>501</string>')
    expect(jobs.issuer).not.toMatch(/@@[A-Z_]+@@/u)
    expect(jobs.broker).not.toContain('AUKORA_ISSUER_APPROVAL_SOCKET')
    expect(renderJobs(launchInputs(validPlan(), ROOT_PEM, BROKER_PEM)).issuer).not.toContain('AUKORA_ISSUER_APPROVAL_SOCKET')
  })

  it('refuses issuer transport controlled by a daemon or guest before provisioning', async () => {
    const plan = validPlan()
    const bundle = {
      issuerApprovalSocket: '/private/var/db/aukora/review/issuer-approval.sock',
      issuerApprovalSocketUid: '501',
    }
    for (const uid of [plan.guestUid, plan.brokerUid, plan.issuerUid]) {
      await expect(runCustodyPair({ ...plan, ...bundle, issuerApprovalSocketUid: String(uid) }, {
        apply: true, platform: 'linux', euid: 0,
      })).rejects.toMatchObject({ reason: CUSTODY_PAIR_REFUSE.ID_COLLISION })
    }
    for (const path of ['/tmp/operator.sock', plan.activationStatementFile, plan.reviewTerminalPublicKeyFile]) {
      refusesWith(
        () => validateCustodyPairPlan({ ...plan, ...bundle, issuerApprovalSocket: path }, REPO_DIR),
        CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED,
      )
    }
    for (const field of Object.keys(bundle)) {
      const incomplete: Record<string, unknown> = { ...plan, ...bundle }
      Reflect.deleteProperty(incomplete, field)
      refusesWith(() => validateCustodyPairPlan(incomplete, REPO_DIR), CUSTODY_PAIR_REFUSE.FIELD_MISSING)
    }
  })

  it('retains the complete memory bundle through installer validation and generation', () => {
    const bundle = memoryBundle()
    const plan = validateCustodyPairPlan({ ...validPlan(), ...bundle }, REPO_DIR)
    const inputs = launchInputs(plan, ROOT_PEM, BROKER_PEM)
    expect(inputs).toMatchObject(bundle)
    const jobs = renderJobs(inputs)
    expect(jobs.broker).toContain(`<string>${bundle.subjectAuthority}</string>`)
    expect(jobs.broker).toContain(`<string>${bundle.rootControlStateFile}</string>`)
    expect(jobs.broker).toContain(bundle.kiraRecallPolicy.replaceAll('"', '&quot;'))
    expect(jobs.issuer).not.toMatch(/AUKORA_(?:KIRA_RECALL_POLICY|SUBJECT_AUTHORITY_B64|ROOT_CONTROL_STATE_FILE)/u)
    expect(jobs.broker).not.toMatch(/@@[A-Z_]+@@/u)
  })

  it('refuses incomplete or malformed memory bundles before host admission', async () => {
    const bundle = memoryBundle()
    for (const field of Object.keys(bundle)) {
      const incomplete: Record<string, unknown> = { ...validPlan(), ...bundle }
      Reflect.deleteProperty(incomplete, field)
      refusesWith(() => validateCustodyPairPlan(incomplete, REPO_DIR), CUSTODY_PAIR_REFUSE.FIELD_MISSING)
      for (const value of ['', undefined, null, {}]) {
        refusesWith(
          () => validateCustodyPairPlan({ ...validPlan(), ...bundle, [field]: value }, REPO_DIR),
          CUSTODY_PAIR_REFUSE.FIELD_INVALID,
        )
      }
    }
    for (const override of [
      { kiraRecallPolicy: '{' }, { kiraRecallPolicy: '{}' },
      { subjectAuthority: 'bad!' }, { subjectAuthority: Buffer.from('{}').toString('base64') },
      { subjectAuthority: `${bundle.subjectAuthority}=` },
      { rootControlStateFile: './control.json' },
    ]) {
      await expect(runCustodyPair({ ...validPlan(), ...bundle, ...override }, {
        apply: true, platform: 'linux', euid: 0,
      })).rejects.toMatchObject({ reason: CUSTODY_PAIR_REFUSE.FIELD_INVALID })
    }
  })

  it.each(['missing', 'guest-owned', 'shared-writable', 'symlink', 'hardlink', 'guest-owned-parent', 'shared-writable-parent'])(
    'refuses a %s public control-state path before host mutation', async (conflict) => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'aukora-control-custody-')))
      custody.root = root
      custody.publicAncestors = true
      const path = join(root, 'control.json')
      try {
        chmodSync(root, 0o755)
        if (conflict !== 'missing') writeFileSync(path, '{}', { mode: 0o644 })
        if (conflict === 'guest-owned') custody.wrongOwner = path
        if (conflict === 'shared-writable') chmodSync(path, 0o666)
        if (conflict === 'symlink') {
          const target = join(root, 'target.json')
          writeFileSync(target, '{}', { mode: 0o644 })
          rmSync(path)
          symlinkSync(target, path)
        }
        if (conflict === 'hardlink') linkSync(path, join(root, 'alias.json'))
        if (conflict === 'guest-owned-parent') custody.wrongOwner = root
        if (conflict === 'shared-writable-parent') chmodSync(root, 0o777)
        await expect(runCustodyPair({ ...validPlan(), ...memoryBundle(), rootControlStateFile: path }, {
          apply: true, platform: 'darwin', euid: 0,
        })).rejects.toMatchObject({ reason: conflict.endsWith('-parent')
          ? CUSTODY_PAIR_REFUSE.PATH_SYMLINK : CUSTODY_PAIR_REFUSE.PATH_CUSTODY_MISMATCH })
      } finally {
        rmSync(root, { recursive: true, force: true })
        Object.assign(custody, { root: '', wrongOwner: '', wrongGroup: '', publicAncestors: false })
      }
    },
  )

  it('admits a public control-state file only with the modeled root custody', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'aukora-control-custody-')))
    const path = join(root, 'control.json')
    try {
      writeFileSync(path, '{}', { mode: 0o644 })
      chmodSync(root, 0o755)
      refusesWith(
        () => { requireRootControlStateFile({ ...validPlan(), rootControlStateFile: path }) },
        CUSTODY_PAIR_REFUSE.PATH_CUSTODY_MISMATCH,
      )
      Object.assign(custody, { root, publicAncestors: true })
      expect(() => { requireRootControlStateFile({ ...validPlan(), rootControlStateFile: path }) }).not.toThrow()
      expect(() => { requireRootControlStateFile(validPlan()) }).not.toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
      Object.assign(custody, { root: '', wrongOwner: '', wrongGroup: '', publicAncestors: false })
    }
  })

  it('observes exactly the program the rendered broker job executes', () => {
    // The installer's expectation and the generator's ProgramArguments are two
    // definitions of one fact. Comparing them through the real predicate is
    // what makes moving the template without moving the expectation fail here
    // rather than after launchctl bootstrap.
    const plan = examplePlan()
    const jobs = renderJobs(launchInputs(plan, ROOT_PEM, BROKER_PEM))
    const expected = expectedJobEntries(plan)
    expect(jobCommandMatches(programArguments(jobs.broker), expected.broker)).toBe(true)
    expect(jobCommandMatches(programArguments(jobs.issuer), expected.issuer)).toBe(true)
    expect(expected.broker.module).toBe(`${plan.implementationRoot}/scripts/launchd-broker-entry.mjs`)

    // The superseded program and any argv drift stay refused.
    expect(jobCommandMatches([plan.nodeBin, `${plan.implementationRoot}/aukora/broker/broker.mjs`], expected.broker)).toBe(false)
    expect(jobCommandMatches([plan.nodeBin], expected.broker)).toBe(false)
    expect(jobCommandMatches([plan.nodeBin, expected.broker.module, '--extra'], expected.broker)).toBe(false)
    expect(jobCommandMatches(['/usr/bin/node', expected.broker.module], expected.broker)).toBe(false)
  })

  it('validates the plan before even the platform gate, so nothing is provisioned', async () => {
    // Ordering proved rather than asserted in prose: on a platform the installer
    // refuses outright, a plan with an invalid review route still reports the
    // plan refusal. Validation therefore precedes the platform gate, which
    // itself precedes every account, directory, key, and job change. `linux`
    // keeps this test incapable of touching the host.
    await expect(runCustodyPair(
      { ...validPlan(), reviewServerId: 'A'.repeat(64) },
      { apply: true, platform: 'linux', euid: 0 },
    )).rejects.toMatchObject({ reason: CUSTODY_PAIR_REFUSE.FIELD_INVALID })
    await expect(runCustodyPair(
      validPlan(),
      { apply: true, platform: 'linux', euid: 0 },
    )).rejects.toMatchObject({ reason: CUSTODY_PAIR_REFUSE.PLATFORM_UNSUPPORTED })
  })

  it('refuses invalid review configuration at plan validation', () => {
    const withoutRoute: Partial<CustodyPairPlan> = validPlan()
    delete withoutRoute.reviewSocket
    refusesWith(() => validateCustodyPairPlan(withoutRoute, REPO_DIR), CUSTODY_PAIR_REFUSE.FIELD_MISSING)
    refusesWith(
      () => validateCustodyPairPlan({ ...validPlan(), reviewServerId: 'A'.repeat(64) }, REPO_DIR),
      CUSTODY_PAIR_REFUSE.FIELD_INVALID,
    )
    for (const override of [
      { reviewSocket: '/private/var/db/aukora/run/issuer/review.sock' },
      { reviewSocket: validPlan().brokerSocket },
      { reviewTerminalPublicKeyFile: '/private/var/db/aukora/broker/terminal.pub' },
    ]) {
      refusesWith(
        () => validateCustodyPairPlan({ ...validPlan(), ...override }, REPO_DIR),
        CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED,
      )
    }

    // A route no daemon can address would otherwise refuse only at startup,
    // after accounts, keys, staged bytes, both property lists and both
    // bootstraps.
    const parent = '/private/var/db/aukora/run/broker'
    const overlong = `${parent}/${'r'.repeat(SUN_PATH_MAX_BYTES - parent.length)}.sock`
    expect(Buffer.byteLength(overlong, 'utf8')).toBeGreaterThan(SUN_PATH_MAX_BYTES)
    refusesWith(
      () => validateCustodyPairPlan({ ...validPlan(), reviewSocket: overlong }, REPO_DIR),
      CUSTODY_PAIR_REFUSE.FIELD_INVALID,
    )
  })

  it('requires the activation statement under root custody before any job is rendered', () => {
    // Called from identity provisioning, which the phase fakes in this suite
    // bypass, so the check is exercised directly here. Its sibling above tests
    // the terminal key the same way; both refuse a file this user owns, because
    // the broker must not be able to rewrite what it is measured against.
    const directory = mkdtempSync(join(tmpdir(), 'aukora-activation-statement-'))
    try {
      const path = join(directory, 'activation.json')
      const plan = { ...validPlan(), activationStatementFile: path }
      refusesWith(() => requireActivationStatement(plan), CUSTODY_PAIR_REFUSE.PATH_CUSTODY_MISMATCH)
      writeFileSync(path, '{}')
      chmodSync(path, 0o644)
      refusesWith(() => requireActivationStatement(plan), CUSTODY_PAIR_REFUSE.PATH_CUSTODY_MISMATCH)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('requires the terminal public key under root custody before any job is rendered', () => {
    // The check runs inside identity provisioning, which precedes every render
    // and publish. A key this user owns is refused: the broker must not be able
    // to replace the key it is held to.
    const directory = mkdtempSync(join(tmpdir(), 'aukora-terminal-key-'))
    try {
      const path = join(directory, 'terminal.pub')
      refusesWith(
        () => requireTerminalPublicKey({ ...validPlan(), reviewTerminalPublicKeyFile: path }),
        CUSTODY_PAIR_REFUSE.PATH_CUSTODY_MISMATCH,
      )
      writeFileSync(path, generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString())
      chmodSync(path, 0o644)
      refusesWith(
        () => requireTerminalPublicKey({ ...validPlan(), reviewTerminalPublicKeyFile: path }),
        CUSTODY_PAIR_REFUSE.PATH_CUSTODY_MISMATCH,
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('accepts only one canonical Ed25519 public key as the terminal key', () => {
    const canonical = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()
    expect(canonicalTerminalPublicKey(canonical, '/k')).toBe(canonical)
    for (const rejected of [
      generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      `${canonical}\n`,
      'not a key',
      '',
    ]) {
      refusesWith(() => canonicalTerminalPublicKey(rejected, '/k'), CUSTODY_PAIR_REFUSE.FIELD_INVALID)
    }
  })

  it('names the invocation-tree refusal exactly', () => {
    expect(CUSTODY_PAIR_REFUSE.INVOCATION_TREE_UNTRUSTED).toBe('launchd-install:invocation-tree-untrusted')
  })

  it('refuses a group- or world-writable invocation ancestor from a disposable fixture', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'aukora-invocation-tree-')))
    try {
      const modulePath = join(root, 'install-launchd-custody-pair.mjs')
      writeFileSync(modulePath, 'fixture')
      chmodSync(root, 0o777)
      refusesWith(
        () => assertInvocationTree({ modulePath, repoRoot: root }),
        CUSTODY_PAIR_REFUSE.INVOCATION_TREE_UNTRUSTED,
      )
    } finally {
      chmodSync(root, 0o755)
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('accepts a modeled root-owned tree and refuses each custody corruption', () => {
    const clean = () => ({ isDirectory: () => true, isSymbolicLink: () => false, uid: 0, mode: 0o755 })
    const options = { modulePath: '/repo/scripts/install-launchd-custody-pair.mjs', repoRoot: '/repo' }
    expect(() => assertInvocationTree({ ...options, stat: () => clean() })).not.toThrow()
    for (const corrupt of [
      () => ({ ...clean(), uid: 501 }),
      () => ({ ...clean(), mode: 0o775 }),
      () => ({ ...clean(), mode: 0o755 | 0o002 }),
      () => ({ isDirectory: () => false, isSymbolicLink: () => false, uid: 0, mode: 0o755 }),
      () => ({ isDirectory: () => true, isSymbolicLink: () => true, uid: 0, mode: 0o755 }),
    ]) {
      refusesWith(
        () => assertInvocationTree({ ...options, stat: () => corrupt() }),
        CUSTODY_PAIR_REFUSE.INVOCATION_TREE_UNTRUSTED,
      )
    }
    refusesWith(
      () => assertInvocationTree({ ...options, stat: () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }) } }),
      CUSTODY_PAIR_REFUSE.INVOCATION_TREE_UNTRUSTED,
    )
  })

  it('refuses --apply at start without gating --check on the invocation tree', () => {
    const script = fileURLToPath(new URL('./install-launchd-custody-pair.mjs', import.meta.url))
    const missing = join(realpathSync(tmpdir()), `aukora-no-such-inputs-${process.pid}.json`)
    const applying = spawnSync(process.execPath, [script, '--inputs', missing, '--apply'], { encoding: 'utf8', timeout: 60_000 })
    expect(applying.status).not.toBe(0)
    expect(`${applying.stderr}${applying.stdout}`).toContain('launchd-install:invocation-tree-untrusted')
    const checking = spawnSync(process.execPath, [script, '--inputs', missing, '--check'], { encoding: 'utf8', timeout: 60_000 })
    expect(checking.status).not.toBe(0)
    expect(`${checking.stderr}${checking.stdout}`).not.toContain('launchd-install:invocation-tree-untrusted')
  })
})
