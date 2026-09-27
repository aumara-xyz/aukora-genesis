/**
 * courts/harness/identity-core — stable subject derivation and attenuation.
 *
 * The court grades the dependency-free identity primitives that precede signed
 * control history and grant v5. Genesis contains only immutable commitments.
 * Delegation claims grant no authority by themselves, but their exact parent,
 * subject, control head, sets, budgets, and time interval must attenuate.
 *
 * The mutation arm deletes the operation-subset check from a copied production
 * module. It passes only when the weakened module admits the widened child and
 * every ordinary row still holds against the unmodified module.
 */
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..', '..')
const MUTATE = process.argv.length === 3 && process.argv[2] === '--mutate'
if (process.argv.length > (MUTATE ? 3 : 2)) {
  console.error(`identity-core: unknown argument ${process.argv[2]}`)
  process.exit(2)
}

const genesisModule = await import(join(ROOT, 'aukora', 'identity', 'genesis.mjs'))
const delegationModule = await import(join(ROOT, 'aukora', 'identity', 'delegation.mjs'))
const {
  IDENTITY_GENESIS_DOMAIN,
  aukoraIdFromGenesis,
  createIdentityGenesis,
  parseIdentityGenesis,
} = genesisModule
const {
  DELEGATION_CLAIM_DOMAIN,
  createDelegationClaim,
  delegationClaimDigest,
  parseDelegationClaim,
  verifyDelegationAttenuation,
} = delegationModule

const hex = pair => pair.repeat(32)
const SUBJECT = `aukora:1:${hex('aa')}`
const CONTROL = hex('bb')
const ACTIVATION_A = hex('10')
const ACTIVATION_B = hex('20')
const ROOT_DELEGATION_DIGEST = '16adae9a03b301ceee8f1c230310d48845c7beb3a31e00bc47bf9635abe2482c'
const GENESIS_VECTOR = Object.freeze({
  genesisNonce: hex('11'),
  initialRootKeySetId: hex('22'),
  amendmentRuleDigest: hex('33'),
})
const EXPECTED_ROWS = Object.freeze([
  'I1.vector', 'I2.closed', 'I3.commitments',
  'D1.attenuation', 'D2.parent', 'D3.subject-control', 'D4.sets',
  'D5.budgets', 'D6.time', 'D7.role', 'D8.strict', 'D9.serialized',
])
const rows = []
const row = (n, label, observed, expected) => {
  rows.push({
    n,
    label,
    observed,
    expected,
    breach: JSON.stringify(observed) !== JSON.stringify(expected),
  })
}

const rootInput = () => ({
  subject: SUBJECT,
  kind: 'root',
  parentDigest: null,
  controlDigest: CONTROL,
  childKeyId: hex('44'),
  operations: ['workspace.patch', 'memory.put'],
  resources: ['memory:key:notes.beta', 'memory:key:notes.alpha'],
  audiences: ['broker:primary', 'broker:recovery'],
  activationDigests: [ACTIVATION_B, ACTIVATION_A],
  budgets: { calls: 100, bytes: 1_000_000, computeMs: 60_000, costMicrounits: 10_000 },
  notBefore: 1_000,
  expiresAt: 10_000,
  revocationId: 'revocation:root:1',
  nonce: hex('55'),
})
const childInput = parentDigest => ({
  subject: SUBJECT,
  kind: 'device',
  parentDigest,
  controlDigest: CONTROL,
  childKeyId: hex('66'),
  operations: ['memory.put'],
  resources: ['memory:key:notes.alpha'],
  audiences: ['broker:primary'],
  activationDigests: [ACTIVATION_A],
  budgets: { calls: 10, bytes: 100_000, computeMs: 10_000, costMicrounits: 1_000 },
  notBefore: 2_000,
  expiresAt: 9_000,
  revocationId: 'revocation:device:1',
  nonce: hex('77'),
})

const genesis = createIdentityGenesis(GENESIS_VECTOR)
const identity = aukoraIdFromGenesis(genesis)
row('I1.vector', 'the immutable genesis vector derives the pinned stable subject', {
  domain: genesis.domain,
  identity,
}, {
  domain: IDENTITY_GENESIS_DOMAIN,
  identity: 'aukora:1:c45ba337e0cb23b52f28e4f5fa16012b13605c347464ead7776ba69cff6ccc2e',
})

const serializedGenesis = JSON.parse(JSON.stringify(genesis))
let accessorInvoked = false
const accessorGenesis = { ...GENESIS_VECTOR }
Object.defineProperty(accessorGenesis, 'genesisNonce', {
  enumerable: true,
  get() {
    accessorInvoked = true
    return hex('11')
  },
})
const hostileGenesis = [
  { ...GENESIS_VECTOR, phrase: 'never-an-identity-field' },
  { ...GENESIS_VECTOR, activeRootKeySetId: hex('99') },
  Object.assign(Object.create({ inherited: true }), GENESIS_VECTOR),
  Object.assign({ ...GENESIS_VECTOR }, { [Symbol('rider')]: true }),
  new Proxy({ ...GENESIS_VECTOR }, {}),
  accessorGenesis,
]
row('I2.closed', 'serialization is stable and executable or mutable authority fields refuse', {
  fields: Object.keys(serializedGenesis).sort(),
  roundTrip: aukoraIdFromGenesis(parseIdentityGenesis(serializedGenesis)),
  refused: hostileGenesis.map(candidate => {
    try { createIdentityGenesis(candidate); return false } catch { return true }
  }),
  accessorInvoked,
}, {
  fields: ['amendmentRuleDigest', 'domain', 'genesisNonce', 'initialRootKeySetId'],
  roundTrip: identity,
  refused: [true, true, true, true, true, true],
  accessorInvoked: false,
})

const genesisVariants = [
  createIdentityGenesis({ ...GENESIS_VECTOR, genesisNonce: hex('12') }),
  createIdentityGenesis({ ...GENESIS_VECTOR, initialRootKeySetId: hex('23') }),
  createIdentityGenesis({ ...GENESIS_VECTOR, amendmentRuleDigest: hex('34') }),
].map(aukoraIdFromGenesis)
row('I3.commitments', 'every immutable genesis commitment changes the subject', {
  distinctFromBase: genesisVariants.every(value => value !== identity),
  distinctFromEachOther: new Set(genesisVariants).size,
}, { distinctFromBase: true, distinctFromEachOther: 3 })

const parent = createDelegationClaim(rootInput())
const parentDigest = delegationClaimDigest(parent)
const child = createDelegationClaim(childInput(parentDigest))
const expected = { subject: SUBJECT, controlDigest: CONTROL }
const bottom = createDelegationClaim({
  ...childInput(parentDigest),
  operations: [],
  resources: [],
  audiences: [],
  activationDigests: [],
  budgets: { calls: 0, bytes: 0, computeMs: 0, costMicrounits: 0 },
})
row('D1.attenuation', 'one exact immediate attenuation is admitted and digest-bound', {
  domain: parent.domain,
  canonicalOperations: parent.operations,
  parentDigest,
  result: verifyDelegationAttenuation(parent, child, expected),
  bottomAdmitted: verifyDelegationAttenuation(parent, bottom, expected).ok,
}, {
  domain: DELEGATION_CLAIM_DOMAIN,
  canonicalOperations: ['memory.put', 'workspace.patch'],
  parentDigest: ROOT_DELEGATION_DIGEST,
  result: { ok: true, childDigest: delegationClaimDigest(child) },
  bottomAdmitted: true,
})

const reasons = candidates => candidates.map(candidate => (
  verifyDelegationAttenuation(parent, createDelegationClaim(candidate), expected).reason
))
row('D2.parent', 'the child pins the exact parent digest', reasons([
  { ...childInput(hex('bd')) },
]), ['delegation:parent-mismatch'])
const wrongSubjectParent = createDelegationClaim({ ...rootInput(), subject: `aukora:1:${hex('ab')}` })
const wrongControlParent = createDelegationClaim({ ...rootInput(), controlDigest: hex('bc') })
row('D3.subject-control', 'subject and active control head cannot be substituted on either side', {
  child: reasons([
    { ...childInput(parentDigest), subject: `aukora:1:${hex('ab')}` },
    { ...childInput(parentDigest), controlDigest: hex('bc') },
  ]),
  parent: [
    verifyDelegationAttenuation(wrongSubjectParent, child, expected).reason,
    verifyDelegationAttenuation(wrongControlParent, child, expected).reason,
  ],
}, {
  child: ['delegation:subject-mismatch', 'delegation:control-mismatch'],
  parent: ['delegation:subject-mismatch', 'delegation:control-mismatch'],
})
row('D4.sets', 'operation resource audience and activation sets cannot widen', reasons([
  { ...rootInput(), kind: 'device', parentDigest, operations: [...rootInput().operations, 'shell.exec'] },
  { ...rootInput(), kind: 'device', parentDigest, resources: [...rootInput().resources, 'memory:key:notes.gamma'] },
  { ...rootInput(), kind: 'device', parentDigest, audiences: [...rootInput().audiences, 'broker:foreign'] },
  { ...rootInput(), kind: 'device', parentDigest, activationDigests: [...rootInput().activationDigests, hex('30')] },
]), [
  'delegation:operation-widened',
  'delegation:resource-widened',
  'delegation:audience-widened',
  'delegation:activation-widened',
])
row('D5.budgets', 'every finite budget refuses independent widening', reasons([
  { ...childInput(parentDigest), budgets: { ...rootInput().budgets, calls: 101 } },
  { ...childInput(parentDigest), budgets: { ...rootInput().budgets, bytes: 1_000_001 } },
  { ...childInput(parentDigest), budgets: { ...rootInput().budgets, computeMs: 60_001 } },
  { ...childInput(parentDigest), budgets: { ...rootInput().budgets, costMicrounits: 10_001 } },
]), [
  'delegation:budget-calls-widened',
  'delegation:budget-bytes-widened',
  'delegation:budget-computeMs-widened',
  'delegation:budget-costMicrounits-widened',
])
row('D6.time', 'a child time interval stays inside its parent interval', reasons([
  { ...childInput(parentDigest), notBefore: 999 },
  { ...childInput(parentDigest), expiresAt: 10_001 },
]), ['delegation:time-widened', 'delegation:time-widened'])
const agent = createDelegationClaim({
  ...childInput(hex('91')),
  kind: 'agent',
  operations: ['memory.put', 'workspace.patch'],
  resources: ['memory:key:notes.alpha', 'memory:key:notes.beta'],
  audiences: ['broker:primary', 'broker:recovery'],
  activationDigests: [ACTIVATION_A, ACTIVATION_B],
  budgets: rootInput().budgets,
  notBefore: 1_000,
  expiresAt: 10_000,
})
const childOfAgent = createDelegationClaim(childInput(delegationClaimDigest(agent)))
const device = createDelegationClaim({ ...rootInput(), kind: 'device', parentDigest: hex('93') })
const session = createDelegationClaim({ ...childInput(delegationClaimDigest(device)), kind: 'session' })
const sessionParent = createDelegationClaim({ ...rootInput(), kind: 'session', parentDigest: hex('94') })
const agentChild = createDelegationClaim({ ...childInput(delegationClaimDigest(sessionParent)), kind: 'agent' })
Object.defineProperty(Object.prototype, 'agent', { configurable: true, value: 'device' })
let pollutedTerminalReason
try {
  pollutedTerminalReason = verifyDelegationAttenuation(agent, childOfAgent, expected).reason
} finally {
  delete Object.prototype.agent
}
row('D7.role', 'only the immediate role transition is valid and terminal agents stay terminal', {
  deviceToSession: verifyDelegationAttenuation(device, session, expected).ok,
  sessionToAgent: verifyDelegationAttenuation(sessionParent, agentChild, expected).ok,
  skipped: reasons([{ ...childInput(parentDigest), kind: 'session' }])[0],
  pollutedTerminal: pollutedTerminalReason,
}, {
  deviceToSession: true,
  sessionToAgent: true,
  skipped: 'delegation:role-transition-invalid',
  pollutedTerminal: 'delegation:role-transition-invalid',
})
row('D8.strict', 'a role change without narrower authority refuses', reasons([{
  ...rootInput(),
  kind: 'device',
  parentDigest,
  childKeyId: hex('88'),
  revocationId: 'revocation:device:equal',
  nonce: hex('89'),
}]), ['delegation:not-attenuated'])

const canonical = createDelegationClaim(rootInput())
const malformed = [
  { ...canonical, grantsAuthority: true },
  { ...canonical, operations: ['workspace.patch', 'memory.put'] },
  { ...canonical, operations: ['memory.put', 'memory.put'] },
  { ...canonical, resources: ['memory:key:*'] },
  { ...canonical, audiences: ['!broker:foreign'] },
  { ...canonical, operations: ['@(memory.put|shell.exec)'] },
  Object.assign(Object.create({ inherited: true }), canonical),
  Object.assign({ ...canonical }, { [Symbol('rider')]: true }),
  new Proxy({ ...canonical }, {}),
]
row('D9.serialized', 'serialized claims refuse riders noncanonical sets duplicates globs and executable objects', {
  refused: malformed.map(candidate => {
    try { parseDelegationClaim(candidate); return false } catch { return true }
  }),
}, { refused: [true, true, true, true, true, true, true, true, true] })

console.log('\n  courts/harness/identity-core — stable subjects and attenuated delegation\n')
for (const result of rows) {
  const verdict = result.breach ? '*** BREACH ***' : 'held'
  console.log(`  ${result.n}  ${result.label.padEnd(68)} ${verdict}  ${JSON.stringify(result.observed).slice(0, 100)}`)
}
const names = new Set(rows.map(({ n }) => n))
const ordinaryRowsHeld = rows.length === EXPECTED_ROWS.length
  && names.size === rows.length
  && EXPECTED_ROWS.every(name => names.has(name))
  && rows.every(({ breach }) => !breach)

if (MUTATE) {
  const temp = mkdtempSync(join(tmpdir(), 'aukora-identity-mutant-'))
  const mutantAukora = join(temp, 'aukora')
  mkdirSync(join(mutantAukora, 'identity'), { recursive: true })
  mkdirSync(join(mutantAukora, 'kernel-seed'), { recursive: true })
  cpSync(join(ROOT, 'aukora', 'identity', 'validation.mjs'), join(mutantAukora, 'identity', 'validation.mjs'))
  cpSync(join(ROOT, 'aukora', 'kernel-seed', 'canonical-json.mjs'), join(mutantAukora, 'kernel-seed', 'canonical-json.mjs'))
  const sourcePath = join(ROOT, 'aukora', 'identity', 'delegation.mjs')
  const mutantPath = join(mutantAukora, 'identity', 'delegation.mjs')
  const source = readFileSync(sourcePath, 'utf8')
  const anchor = "if (!subset(parent.operations, child.operations)) return refusal('delegation:operation-widened')"
  const weakened = source.replace(anchor, "if (false && !subset(parent.operations, child.operations)) return refusal('delegation:operation-widened')")
  const anchorApplied = weakened !== source && source.split(anchor).length === 2
  writeFileSync(mutantPath, weakened, 'utf8')
  const mutant = await import(`${pathToFileURL(mutantPath).href}?mutation=operation-attenuation`)
  const mutantParent = mutant.createDelegationClaim(rootInput())
  const mutantParentDigest = mutant.delegationClaimDigest(mutantParent)
  const widened = mutant.createDelegationClaim({
    ...childInput(mutantParentDigest),
    operations: ['memory.put', 'shell.exec'],
  })
  const controlRefused = verifyDelegationAttenuation(parent, createDelegationClaim({
    ...childInput(parentDigest),
    operations: ['memory.put', 'shell.exec'],
  }), expected).reason === 'delegation:operation-widened'
  const widenedAdmitted = mutant.verifyDelegationAttenuation(mutantParent, widened, expected).ok === true
  const detected = anchorApplied && controlRefused && widenedAdmitted && ordinaryRowsHeld
  console.log(`\n  MUTATION operation attenuation guard  sourceApplied=${anchorApplied} controlRefused=${controlRefused} widenedChildAdmitted=${widenedAdmitted} ordinaryRowsHeld=${ordinaryRowsHeld}  ${detected ? 'DETECTED' : 'NOT DETECTED'}\n`)
  rmSync(temp, { recursive: true, force: true })
  process.exit(detected ? 0 : 1)
}

console.log('\n  observationClass: IDENTITY-PRIMITIVES-ONLY / UNSIGNED-DELEGATION-GRANTS-NO-AUTHORITY\n')
process.exit(ordinaryRowsHeld ? 0 : 1)
