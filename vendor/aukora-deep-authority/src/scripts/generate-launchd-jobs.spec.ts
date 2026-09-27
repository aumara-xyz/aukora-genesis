import { generateKeyPairSync } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { receiptKeyIdForPublicKey } from '../aukora/host-dsh/src/grant.mjs'
import { encodeSubjectAuthorityContext } from '../aukora/broker/subject-authority.mjs'
import { createDelegationClaim, delegationClaimDigest } from '../aukora/identity/delegation.mjs'
import {
  LAUNCHD_REFUSE,
  checkReport,
  isInside,
  lintJobs,
  renderJobs,
  renderTemplate,
  validateInputs,
  writeExclusiveJobs,
} from './generate-launchd-jobs.mjs'
import type { LaunchdInputs, ValidatedLaunchdInputs } from './generate-launchd-jobs.mjs'

const REPO_DIR = '/repo/aukora-deep'
const root = generateKeyPairSync('ed25519')
const broker = generateKeyPairSync('ed25519')
const ROOT_PUBLIC_KEY_PEM = root.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const BROKER_PUBLIC_KEY_PEM = broker.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const ROOT_PRIVATE_KEY_PEM = root.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const EXPECTED_RECEIPT_KEY_ID = receiptKeyIdForPublicKey(BROKER_PUBLIC_KEY_PEM)
const temporaryDirectories: string[] = []

/** Inputs that satisfy every rule, so each refusal changes one value. */
function validInputs(): LaunchdInputs {
  return {
    brokerLabel: 'com.aukora.broker',
    brokerUser: '_aukora_broker',
    brokerGroup: '_aukora_guest_route',
    brokerSocket: '/private/var/run/aukora/broker/broker.sock',
    brokerStateDir: '/private/var/lib/aukora/broker',
    brokerPublicKeyPem: BROKER_PUBLIC_KEY_PEM,
    rootPublicKeyPem: ROOT_PUBLIC_KEY_PEM,
    issuerLabel: 'com.aukora.issuer',
    issuerUser: '_aukora_issuer',
    issuerGroup: '_aukora_issuer_route',
    issuerSocket: '/private/var/run/aukora/issuer/issuer.sock',
    issuerStateDir: '/private/var/lib/aukora/issuer',
    issuerKeyFile: '/private/var/lib/aukora/issuer/ed25519.key',
    implementationRoot: '/private/var/db/aukora/implementation',
    nodeBin: '/opt/homebrew/bin/node',
    reviewSocket: '/private/var/run/aukora/broker/review.sock',
    reviewTerminalPublicKeyFile: '/private/var/db/aukora/terminal-ed25519.pub.pem',
    reviewServerId: 'a'.repeat(64),
    activationStatementFile: '/private/var/db/aukora/review/activation.json',
    activationDigest: 'b'.repeat(64),
    rendererId: 'c'.repeat(64),
  }
}

function memoryBundle() {
  const subject = `aukora:1:${'a'.repeat(64)}`
  const activationDigest = validInputs().activationDigest
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
    kiraRecallPolicy: JSON.stringify({ subject, privacy: ['private', 'local'] }, null, 2),
    subjectAuthority: encodeSubjectAuthorityContext({
      subject, activeControlDigest: claim.controlDigest, activationDigest,
      audience: 'broker:test', parentDelegationClaim: parent, delegationClaim: agent,
    }),
    rootControlStateFile: '/private/var/db/aukora/review/root-control.json',
  }
}

function environment(plist: string): Record<string, string> {
  const result = spawnSync('/usr/bin/plutil', ['-extract', 'EnvironmentVariables', 'json', '-o', '-', '-'], {
    input: plist, encoding: 'utf8',
  })
  expect(result.status).toBe(0)
  return JSON.parse(result.stdout) as Record<string, string>
}

/** Validate and render one honest pair. */
function honestPair(inputs: LaunchdInputs = validInputs()): {
  inputs: ValidatedLaunchdInputs
  jobs: { broker: string; issuer: string }
} {
  const validated = validateInputs(inputs, REPO_DIR)
  return { inputs: validated, jobs: renderJobs(validated) }
}

/** Assert refusal by stable name rather than message prose. */
function refusesWith(inputs: unknown, reason: string): void {
  expect(() => validateInputs(inputs, REPO_DIR)).toThrow(
    expect.objectContaining({ reason }),
  )
}

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), prefix))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('launchd job generation', () => {
  it('derives the issuer receipt-key identity from the canonical broker key', () => {
    const inputs = validateInputs(validInputs(), REPO_DIR)
    expect(inputs.expectedReceiptKeyId).toBe(EXPECTED_RECEIPT_KEY_ID)
    expect(inputs).not.toHaveProperty('expectedReceiptKeyId', 'caller-authored')
  })

  it('renders the exact daemon environment and distinct route groups', () => {
    const { jobs } = honestPair()
    const clearedPreloadVariables = [
      'NODE_OPTIONS',
      'NODE_PATH',
      'NODE_REPL_EXTERNAL_MODULE',
      'ELECTRON_RUN_AS_NODE',
      'NODE_COMPILE_CACHE',
      'LD_PRELOAD',
      'LD_AUDIT',
      'LD_LIBRARY_PATH',
      'DYLD_INSERT_LIBRARIES',
      'DYLD_FRAMEWORK_PATH',
      'DYLD_LIBRARY_PATH',
      'DYLD_FALLBACK_LIBRARY_PATH',
      'OPENSSL_CONF',
      'OPENSSL_MODULES',
    ]
    for (const name of clearedPreloadVariables) {
      const cleared = `<key>${name}</key>\n    <string></string>`
      expect(jobs.broker).toContain(cleared)
      expect(jobs.issuer).toContain(cleared)
    }
    expect(jobs.broker).toContain('<key>AUKORA_SOCKET</key>')
    expect(jobs.broker).not.toContain('AUKORA_BROKER_SOCKET')
    expect(jobs.broker).toContain('<key>AUKORA_ROOT_PEM</key>')
    expect(jobs.broker).toContain('<string>_aukora_guest_route</string>')
    expect(jobs.issuer).toContain('<string>_aukora_issuer_route</string>')
    expect(jobs.issuer).toContain(`<string>${EXPECTED_RECEIPT_KEY_ID}</string>`)
    expect(jobs.broker).toContain('<key>AUKORA_SOCKET_GROUP_ACCESS</key>')
    expect(jobs.issuer).toContain('<key>AUKORA_ISSUER_SOCKET_GROUP_ACCESS</key>')
  })

  it('omits issuer approval transport unless both explicit fields are supplied', () => {
    const ordinary = honestPair().jobs
    expect(ordinary.issuer).not.toContain('AUKORA_ISSUER_APPROVAL_SOCKET')
    const configured = honestPair({
      ...validInputs(),
      issuerApprovalSocket: '/private/var/db/aukora/review/issuer-approval.sock',
      issuerApprovalSocketUid: '501',
    }).jobs
    expect(configured.broker).toBe(ordinary.broker)
    expect(configured.issuer).not.toMatch(/@@[A-Z_]+@@/u)
    if (process.platform === 'darwin') {
      expect(environment(configured.issuer)).toMatchObject({
        AUKORA_ISSUER_APPROVAL_SOCKET: '/private/var/db/aukora/review/issuer-approval.sock',
        AUKORA_ISSUER_APPROVAL_SOCKET_UID: '501',
      })
    }
  })

  it('refuses incomplete, malformed and colliding issuer approval transports', () => {
    const bundle = {
      issuerApprovalSocket: '/private/var/db/aukora/review/issuer-approval.sock',
      issuerApprovalSocketUid: '501',
    }
    for (const field of Object.keys(bundle)) {
      const incomplete: Record<string, unknown> = { ...validInputs(), ...bundle }
      Reflect.deleteProperty(incomplete, field)
      refusesWith(incomplete, LAUNCHD_REFUSE.FIELD_MISSING)
    }
    for (const uid of ['-1', '01', '4294967295', '9007199254740992', '501\n', 'nobody', 501, null]) {
      expect(() => validateInputs({ ...validInputs(), ...bundle, issuerApprovalSocketUid: uid }, REPO_DIR)).toThrow()
    }
    refusesWith({ ...validInputs(), ...bundle, issuerApprovalSocket: './operator.sock' }, LAUNCHD_REFUSE.PATH_NOT_ABSOLUTE)
    for (const path of ['/private/var/db/aukora/review/../review/operator.sock', '/private/var/db/aukora/review//operator.sock']) {
      refusesWith({ ...validInputs(), ...bundle, issuerApprovalSocket: path }, LAUNCHD_REFUSE.PATH_NOT_NORMALIZED)
    }
    for (const path of [validInputs().brokerSocket, validInputs().issuerSocket, validInputs().reviewSocket]) {
      refusesWith({ ...validInputs(), ...bundle, issuerApprovalSocket: path }, LAUNCHD_REFUSE.SOCKET_PARENTS_COLLAPSE)
    }
    for (const root of [REPO_DIR, validInputs().brokerStateDir, validInputs().issuerStateDir]) {
      refusesWith({ ...validInputs(), ...bundle, issuerApprovalSocket: `${root}/operator.sock` }, LAUNCHD_REFUSE.STATE_INSIDE_CHECKOUT)
    }
  })

  it('omits every memory environment key when the bundle is absent', () => {
    const { jobs } = honestPair()
    for (const job of Object.values(jobs)) {
      expect(job).not.toMatch(/AUKORA_(?:KIRA_RECALL_POLICY|SUBJECT_AUTHORITY_B64|ROOT_CONTROL_STATE_FILE)/u)
      expect(job).not.toMatch(/@@[A-Z_]+@@/u)
    }
  })

  it('preserves the explicit memory strings only in the broker environment', () => {
    const bundle = memoryBundle()
    const { jobs } = honestPair({ ...validInputs(), ...bundle })
    expect(environment(jobs.broker)).toMatchObject({
      AUKORA_KIRA_RECALL_POLICY: bundle.kiraRecallPolicy,
      AUKORA_SUBJECT_AUTHORITY_B64: bundle.subjectAuthority,
      AUKORA_ROOT_CONTROL_STATE_FILE: bundle.rootControlStateFile,
    })
    expect(jobs.issuer).not.toMatch(/AUKORA_(?:KIRA_RECALL_POLICY|SUBJECT_AUTHORITY_B64|ROOT_CONTROL_STATE_FILE)/u)
    expect(jobs.broker).not.toMatch(/@@[A-Z_]+@@/u)
    lintJobs(jobs)
  })

  it('refuses each incomplete memory bundle and every supplied non-string value', () => {
    const bundle = memoryBundle()
    for (const field of Object.keys(bundle)) {
      const incomplete: Record<string, unknown> = { ...validInputs(), ...bundle }
      Reflect.deleteProperty(incomplete, field)
      refusesWith(incomplete, LAUNCHD_REFUSE.FIELD_MISSING)
      refusesWith({ ...validInputs(), [field]: bundle[field as keyof typeof bundle] }, LAUNCHD_REFUSE.FIELD_MISSING)
      for (const value of ['', undefined, null, {}]) {
        refusesWith({ ...validInputs(), ...bundle, [field]: value }, LAUNCHD_REFUSE.FIELD_NOT_STRING)
      }
    }
  })

  it('refuses malformed policies, authority encodings, and relative control-state paths', () => {
    const bundle = memoryBundle()
    for (const kiraRecallPolicy of ['{', '{}', 'null', JSON.stringify({ subject: 'chosen', privacy: [] }),
      JSON.stringify({ subject: 'chosen', privacy: ['inferred'] })]) {
      refusesWith({ ...validInputs(), ...bundle, kiraRecallPolicy }, LAUNCHD_REFUSE.MEMORY_CONFIGURATION_INVALID)
    }
    for (const subjectAuthority of ['bad!', Buffer.from('{}').toString('base64'), `${bundle.subjectAuthority}=`, `${bundle.subjectAuthority}\n`]) {
      refusesWith({ ...validInputs(), ...bundle, subjectAuthority }, subjectAuthority.endsWith('\n')
        ? LAUNCHD_REFUSE.FIELD_XML_UNSAFE : LAUNCHD_REFUSE.MEMORY_CONFIGURATION_INVALID)
    }
    refusesWith({ ...validInputs(), ...bundle, rootControlStateFile: './control.json' }, LAUNCHD_REFUSE.PATH_NOT_ABSOLUTE)
    refusesWith({ ...validInputs(), ...bundle, rootControlStateFile: `${REPO_DIR}/control.json` }, LAUNCHD_REFUSE.STATE_INSIDE_CHECKOUT)
  })

  it('refuses a memory policy whose subject differs from the validated authority', () => {
    refusesWith({
      ...validInputs(), ...memoryBundle(),
      kiraRecallPolicy: JSON.stringify({ subject: `aukora:1:${'d'.repeat(64)}`, privacy: ['local'] }),
    }, LAUNCHD_REFUSE.MEMORY_CONFIGURATION_INVALID)
  })

  it('refuses a memory authority whose activation differs from the selected activation', () => {
    refusesWith({
      ...validInputs(), ...memoryBundle(), activationDigest: 'd'.repeat(64),
    }, LAUNCHD_REFUSE.MEMORY_CONFIGURATION_INVALID)
  })

  it('leaves no unresolved placeholder and binds the explicit implementation root', () => {
    const { inputs, jobs } = honestPair()
    expect(jobs.broker).not.toMatch(/@@[A-Z_]+@@/)
    expect(jobs.issuer).not.toMatch(/@@[A-Z_]+@@/)
    // The broker job must select the reviewed entry. broker.mjs takes its
    // review callback from a Node IPC parent a LaunchDaemon cannot supply, so
    // selecting it directly is the unreviewed path this entry exists to
    // replace; asserting only the presence of the entry would still pass if
    // both were listed, so its absence is asserted too.
    expect(jobs.broker).toContain(`${inputs.implementationRoot}/scripts/launchd-broker-entry.mjs`)
    expect(jobs.broker).not.toContain(`${inputs.implementationRoot}/aukora/broker/broker.mjs`)
    expect(jobs.issuer).toContain(`${inputs.implementationRoot}/aukora/issuer/issuer.mjs`)
    expect(jobs.broker).not.toContain(REPO_DIR)
    expect(jobs.issuer).not.toContain(REPO_DIR)
  })

  it('escapes closing tags and ampersands before plist interpolation', () => {
    const inputs = validInputs()
    inputs.brokerStateDir = '/private/var/lib/a&b</string><key>Injected</key><string>'
    const { jobs } = honestPair(inputs)
    expect(jobs.broker).toContain('/private/var/lib/a&amp;b&lt;/string&gt;&lt;key&gt;Injected')
    expect(jobs.broker).not.toContain('<key>Injected</key>')
    expect(() => { lintJobs(jobs) }).not.toThrow()
  })

  it('validates both rendered jobs with the host plist parser', () => {
    expect(() => { lintJobs(honestPair().jobs) }).not.toThrow()
    expect(() => { lintJobs({ broker: '<plist>', issuer: '<plist>' }) }).toThrow(
      expect.objectContaining({ reason: LAUNCHD_REFUSE.PLIST_INVALID }),
    )
  })

  it('refuses an unknown input field instead of ignoring it', () => {
    const inputs = { ...validInputs(), expectedReceiptKeyId: 'caller-authored' }
    refusesWith(inputs, LAUNCHD_REFUSE.FIELD_UNKNOWN)
  })

  it('snapshots data properties without invoking accessors', () => {
    const inputs = validInputs()
    let reads = 0
    Object.defineProperty(inputs, 'issuerUser', {
      enumerable: true,
      get: () => { reads += 1; return '_aukora_issuer' },
    })
    refusesWith(inputs, LAUNCHD_REFUSE.INPUTS_NOT_PLAIN)
    expect(reads).toBe(0)
  })

  it('refuses XML and display controls before rendering', () => {
    const inputs = validInputs()
    inputs.brokerUser = '_aukora\u202ebroker'
    refusesWith(inputs, LAUNCHD_REFUSE.FIELD_XML_UNSAFE)
  })

  it('refuses reserved template syntax in principals, groups, and paths', () => {
    for (const [field, value] of [
      ['brokerUser', '@@ISSUER_USER@@'],
      ['brokerGroup', '@@ISSUER_GROUP@@'],
      ['issuerKeyFile', '//@@IMPLEMENTATION_ROOT@@/secrets/root.pem'],
    ] as const) {
      const inputs = validInputs()
      inputs[field] = value
      refusesWith(inputs, LAUNCHD_REFUSE.FIELD_PLACEHOLDER_UNSAFE)
    }
  })

  it('never rescans an inserted value as a later template token', () => {
    const inputs = {
      ...validateInputs(validInputs(), REPO_DIR),
      brokerUser: '@@ISSUER_USER@@',
    }
    expect(() => renderTemplate(
      '<string>@@BROKER_USER@@</string><string>@@ISSUER_USER@@</string>',
      inputs,
    )).toThrow(expect.objectContaining({ reason: LAUNCHD_REFUSE.PLACEHOLDER_UNRESOLVED }))
  })

  it('refuses equal account names without relying on case', () => {
    const inputs = validInputs()
    inputs.issuerUser = '_AUKORA_BROKER'
    refusesWith(inputs, LAUNCHD_REFUSE.PRINCIPALS_COLLAPSE)
  })

  it('refuses one group for both route peer sets', () => {
    const inputs = validInputs()
    inputs.issuerGroup = inputs.brokerGroup
    refusesWith(inputs, LAUNCHD_REFUSE.GROUPS_COLLAPSE)
  })

  it('refuses both sockets under one owner directory', () => {
    const inputs = validInputs()
    inputs.issuerSocket = '/private/var/run/aukora/broker/issuer.sock'
    refusesWith(inputs, LAUNCHD_REFUSE.SOCKET_PARENTS_COLLAPSE)
  })

  it('refuses labels that can escape or nest the output directory', () => {
    for (const label of ['../com.aukora.broker', 'com/aukora/broker', 'com..aukora']) {
      const inputs = validInputs()
      inputs.brokerLabel = label
      refusesWith(inputs, LAUNCHD_REFUSE.LABEL_UNSAFE)
    }
  })

  it('refuses duplicate labels', () => {
    const inputs = validInputs()
    inputs.issuerLabel = inputs.brokerLabel
    refusesWith(inputs, LAUNCHD_REFUSE.LABELS_COLLAPSE)
  })

  it('refuses a private key at either public-key input', () => {
    const rootInputs = validInputs()
    rootInputs.rootPublicKeyPem = ROOT_PRIVATE_KEY_PEM
    refusesWith(rootInputs, LAUNCHD_REFUSE.PUBLIC_KEY_INVALID)
    const brokerInputs = validInputs()
    brokerInputs.brokerPublicKeyPem = ROOT_PRIVATE_KEY_PEM
    refusesWith(brokerInputs, LAUNCHD_REFUSE.PUBLIC_KEY_INVALID)
  })

  it('refuses a signing key stored inside the checkout', () => {
    const inputs = validInputs()
    inputs.issuerKeyFile = `${REPO_DIR}/secrets/ed25519.key`
    refusesWith(inputs, LAUNCHD_REFUSE.SECRET_INSIDE_CHECKOUT)
  })

  it('refuses an implementation root inside the checkout', () => {
    const inputs = validInputs()
    inputs.implementationRoot = `${REPO_DIR}/installed`
    refusesWith(inputs, LAUNCHD_REFUSE.IMPLEMENTATION_INSIDE_CHECKOUT)
  })

  it('refuses run state stored inside the checkout', () => {
    const inputs = validInputs()
    inputs.brokerStateDir = `${REPO_DIR}/state/broker`
    refusesWith(inputs, LAUNCHD_REFUSE.STATE_INSIDE_CHECKOUT)
  })

  it('refuses a signing key inside broker-owned state', () => {
    const inputs = validInputs()
    inputs.brokerStateDir = '/private/var/lib/aukora'
    inputs.issuerKeyFile = '/private/var/lib/aukora/issuer.key'
    refusesWith(inputs, LAUNCHD_REFUSE.KEY_READABLE_BY_BROKER)
  })

  it('refuses relative, missing, empty, and non-plain inputs', () => {
    const relative = validInputs()
    relative.implementationRoot = 'var/db/aukora/implementation'
    refusesWith(relative, LAUNCHD_REFUSE.PATH_NOT_ABSOLUTE)
    const missing: Partial<LaunchdInputs> = validInputs()
    delete missing.issuerKeyFile
    refusesWith(missing, LAUNCHD_REFUSE.FIELD_MISSING)
    const empty = validInputs()
    empty.issuerUser = ''
    refusesWith(empty, LAUNCHD_REFUSE.FIELD_NOT_STRING)
    refusesWith([validInputs()], LAUNCHD_REFUSE.INPUTS_NOT_PLAIN)
  })

  it('writes both leaves exclusively without replacing existing entries', () => {
    const out = temporaryDirectory('aukora-launchd-output-')
    const { inputs, jobs } = honestPair()
    const paths = writeExclusiveJobs(out, inputs, jobs)
    expect(paths).toHaveLength(2)
    expect(readFileSync(paths[0] ?? '', 'utf8')).toBe(jobs.broker)
    expect(readFileSync(paths[1] ?? '', 'utf8')).toBe(jobs.issuer)
    expect(lstatSync(paths[0] ?? '').isFile()).toBe(true)
    expect(() => writeExclusiveJobs(out, inputs, jobs)).toThrow(
      expect.objectContaining({ reason: LAUNCHD_REFUSE.OUTPUT_EXISTS }),
    )
  })

  it('preserves a symbolic-link output target and emits neither job', () => {
    const out = temporaryDirectory('aukora-launchd-link-')
    const target = join(out, 'target')
    writeFileSync(target, 'KEEP', 'utf8')
    const { inputs, jobs } = honestPair()
    const brokerPath = join(out, `${inputs.brokerLabel}.plist`)
    const issuerPath = join(out, `${inputs.issuerLabel}.plist`)
    symlinkSync(target, brokerPath)
    expect(() => writeExclusiveJobs(out, inputs, jobs)).toThrow(
      expect.objectContaining({ reason: LAUNCHD_REFUSE.OUTPUT_EXISTS }),
    )
    expect(readFileSync(target, 'utf8')).toBe('KEEP')
    expect(() => lstatSync(issuerPath)).toThrow()
  })

  it('preflights both output names before writing either one', () => {
    const out = temporaryDirectory('aukora-launchd-existing-')
    const { inputs, jobs } = honestPair()
    const brokerPath = join(out, `${inputs.brokerLabel}.plist`)
    const issuerPath = join(out, `${inputs.issuerLabel}.plist`)
    writeFileSync(issuerPath, 'KEEP', 'utf8')
    expect(() => writeExclusiveJobs(out, inputs, jobs)).toThrow(
      expect.objectContaining({ reason: LAUNCHD_REFUSE.OUTPUT_EXISTS }),
    )
    expect(() => lstatSync(brokerPath)).toThrow()
    expect(readFileSync(issuerPath, 'utf8')).toBe('KEEP')
  })

  it('rolls back its first leaf when the second name appears after preflight', () => {
    const out = temporaryDirectory('aukora-launchd-race-')
    const { inputs, jobs } = honestPair()
    const brokerPath = join(out, `${inputs.brokerLabel}.plist`)
    const issuerPath = join(out, `${inputs.issuerLabel}.plist`)
    const racedJobs = {
      get broker(): string {
        writeFileSync(issuerPath, 'FOREIGN', 'utf8')
        return jobs.broker
      },
      issuer: jobs.issuer,
    }

    expect(() => writeExclusiveJobs(out, inputs, racedJobs)).toThrow(
      expect.objectContaining({ reason: LAUNCHD_REFUSE.OUTPUT_EXISTS }),
    )
    expect(() => lstatSync(brokerPath)).toThrow()
    expect(readFileSync(issuerPath, 'utf8')).toBe('FOREIGN')
  })

  it('does not delete a foreign replacement while rolling back its first leaf', () => {
    const out = temporaryDirectory('aukora-launchd-replaced-')
    const { inputs, jobs } = honestPair()
    const brokerPath = join(out, `${inputs.brokerLabel}.plist`)
    const issuerPath = join(out, `${inputs.issuerLabel}.plist`)
    const racedJobs = {
      get broker(): string {
        unlinkSync(brokerPath)
        writeFileSync(brokerPath, 'FOREIGN BROKER', 'utf8')
        writeFileSync(issuerPath, 'FOREIGN ISSUER', 'utf8')
        return jobs.broker
      },
      issuer: jobs.issuer,
    }

    expect(() => writeExclusiveJobs(out, inputs, racedJobs)).toThrow(
      expect.objectContaining({ reason: LAUNCHD_REFUSE.OUTPUT_ROLLBACK_INDETERMINATE }),
    )
    expect(readFileSync(brokerPath, 'utf8')).toBe('FOREIGN BROKER')
    expect(readFileSync(issuerPath, 'utf8')).toBe('FOREIGN ISSUER')
  })

  it('reports indeterminate rollback when the output directory moves during publication', () => {
    const rootDirectory = temporaryDirectory('aukora-launchd-moved-')
    const out = join(rootDirectory, 'out')
    const moved = join(rootDirectory, 'moved')
    mkdirSync(out, { mode: 0o700 })
    const { inputs, jobs } = honestPair()
    const movedBrokerPath = join(moved, `${inputs.brokerLabel}.plist`)
    const racedJobs = {
      get broker(): string {
        renameSync(out, moved)
        writeFileSync(out, 'FOREIGN PATH', 'utf8')
        return jobs.broker
      },
      issuer: jobs.issuer,
    }

    expect(() => writeExclusiveJobs(out, inputs, racedJobs)).toThrow(
      expect.objectContaining({ reason: LAUNCHD_REFUSE.OUTPUT_ROLLBACK_INDETERMINATE }),
    )
    expect(readFileSync(movedBrokerPath, 'utf8')).toBe(jobs.broker)
    expect(readFileSync(out, 'utf8')).toBe('FOREIGN PATH')
  })

  it('refuses relative and non-directory output paths', () => {
    const { inputs, jobs } = honestPair()
    expect(() => writeExclusiveJobs('relative-output', inputs, jobs)).toThrow(
      expect.objectContaining({ reason: LAUNCHD_REFUSE.OUTPUT_DIR_UNSAFE }),
    )
    const rootDirectory = temporaryDirectory('aukora-launchd-output-file-')
    const file = join(rootDirectory, 'file')
    writeFileSync(file, 'not-a-directory', 'utf8')
    expect(() => writeExclusiveJobs(file, inputs, jobs)).toThrow(
      expect.objectContaining({ reason: LAUNCHD_REFUSE.OUTPUT_DIR_UNSAFE }),
    )

    const ancestorRoot = temporaryDirectory('aukora-launchd-output-ancestor-')
    const actual = join(ancestorRoot, 'actual')
    const alias = join(ancestorRoot, 'alias')
    mkdirSync(actual, { mode: 0o700 })
    symlinkSync(actual, alias)
    expect(() => writeExclusiveJobs(join(alias, 'nested'), inputs, jobs)).toThrow(
      expect.objectContaining({ reason: LAUNCHD_REFUSE.OUTPUT_DIR_UNSAFE }),
    )
  })

  it('reports names without claiming numeric principal separation', () => {
    const { inputs } = honestPair()
    const report = checkReport(inputs, REPO_DIR)
    expect(report).toMatchObject({
      distinctPrincipalNames: true,
      distinctRouteGroupNames: true,
      distinctSocketParents: true,
      expectedReceiptKeyId: EXPECTED_RECEIPT_KEY_ID,
      implementationRootLexicallyOutsideCheckout: true,
      issuerKeyPathLexicallyOutsideCheckout: true,
      plutilLinted: true,
    })
    expect(report).not.toHaveProperty('distinctPrincipals')
    expect(report).not.toHaveProperty('groupMembershipObserved')
  })

  it('does not treat a sibling directory as a child', () => {
    expect(isInside('/var/lib/aukora-other/key', '/var/lib/aukora')).toBe(false)
    expect(isInside('/var/lib/aukora/key', '/var/lib/aukora')).toBe(true)
  })

  it('refuses a review route that collides with the broker or issuer route', () => {
    // The review route shares the broker's parent by design, so the parent
    // comparison cannot catch this; the routes themselves must be distinct.
    for (const field of ['brokerSocket', 'issuerSocket'] as const) {
      refusesWith(
        { ...validInputs(), reviewSocket: validInputs()[field] },
        LAUNCHD_REFUSE.SOCKET_PARENTS_COLLAPSE,
      )
    }
  })

  it('refuses review paths inside the checkout', () => {
    for (const field of ['reviewSocket', 'reviewTerminalPublicKeyFile'] as const) {
      refusesWith(
        { ...validInputs(), [field]: join(REPO_DIR, 'scratch', 'r') },
        LAUNCHD_REFUSE.STATE_INSIDE_CHECKOUT,
      )
    }
  })

  it('refuses a terminal public key the broker principal could replace', () => {
    // Readable is required; replaceable is the defect. Inside brokerStateDir the
    // broker owns the directory and could substitute a key it controls.
    refusesWith(
      { ...validInputs(), reviewTerminalPublicKeyFile: join(validInputs().brokerStateDir, 'terminal.pub') },
      LAUNCHD_REFUSE.KEY_READABLE_BY_BROKER,
    )
  })

  it('refuses a review server identity that is not lowercase 64-character hex', () => {
    // The generator is also a standalone operator entry point, so a malformed
    // identity must refuse here rather than at daemon startup.
    for (const reviewServerId of ['A'.repeat(64), 'z'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'not a hex identity']) {
      refusesWith({ ...validInputs(), reviewServerId }, LAUNCHD_REFUSE.FIELD_NOT_STRING)
    }
  })
})
