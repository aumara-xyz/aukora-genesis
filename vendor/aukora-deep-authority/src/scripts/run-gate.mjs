import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync, existsSync, lstatSync, openSync, readFileSync,
  readlinkSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync,
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import { delimiter, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  EXPECTED_GATE_RUNS,
  amendmentChannelMutationFaults,
  classifiedRunCount,
  gateRosterFaults,
  keptBreachFaults,
  liveDispatchMutationFaults,
  liveDispatchNormalFaults,
  mutationResultFaults,
  ordinaryResultFaults,
  parseCourtRows,
  resolvePathExecutables,
} from './court-gate-classification.mjs'
import { prepareGateBuildEnvironment, prepareGateEnvironment } from './court-gate-environment.mjs'
import {
  buildCourtGateReport,
  courtGateReportEnabled,
  courtGateProcessResult,
  persistCourtGateReportDescriptor,
  resolveCourtGateReportDescriptor,
} from './court-gate-report.mjs'
import { evaluateOpenFindings, formatOpenFindingsAdvisory } from './open-findings.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// The open-finding advisory is reported, never graded. It runs here because
// this is the only statement every run reaches: each of the nineteen
// precondition exits below is downstream of it, so a finding stays visible on a
// run that never dispatches a court. It reads two files and writes stdout; it
// contributes to no counter, no fault list, and no exit code, and a manifest it
// cannot read degrades to a named warning rather than a thrown error.
try {
  for (const line of formatOpenFindingsAdvisory(evaluateOpenFindings(ROOT))) console.log(line)
} catch (error) {
  console.log(`\n  OPEN FINDINGS UNAVAILABLE — ${String(error?.message ?? error)}; this does not affect the gate verdict.`)
}
let REPORT_DESCRIPTOR
try {
  REPORT_DESCRIPTOR = resolveCourtGateReportDescriptor(process.argv.slice(2))
} catch (error) {
  console.error(`\n  *** GATE PRECONDITION FAILED *** ${String(error?.message ?? error)}`)
  process.exit(1)
}
const REPORT_ENABLED = courtGateReportEnabled(REPORT_DESCRIPTOR)
// Every child measures the repository-owned profile, never a developer's
// ambient Harness home. The runner's challenge and the court therefore name
// the same closure even when the caller exported DSH_HOME for another app.
const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null'
const preparedEnvironment = prepareGateEnvironment(process.env, { root: ROOT, nullDevice: NULL_DEVICE })
for (const name of preparedEnvironment.rejectedNames) {
  console.error(`\n  *** GATE PRECONDITION FAILED *** ${name} may alter the runner or court executable closure`)
  process.exit(1)
}
const GATE_ENV = preparedEnvironment.env
const GATE_BUILD_ENV = prepareGateBuildEnvironment(GATE_ENV)
const PATH_ENTRIES = (GATE_ENV.PATH ?? '').split(delimiter)
if (PATH_ENTRIES.length === 0 || PATH_ENTRIES.some(entry => entry === '' || !isAbsolute(entry))) {
  console.error('\n  *** GATE PRECONDITION FAILED *** PATH must contain only non-empty absolute directories')
  process.exit(1)
}
/** Resolve one executable from the exact absolute PATH inherited by children. */
const resolveGateExecutable = (name) => {
  const [{ path }] = resolvePathExecutables(PATH_ENTRIES, [name])
  if (path !== null) return path
  throw new Error(`${name} was not found on the fixed gate PATH`)
}
const GIT_PATH = resolveGateExecutable(process.platform === 'win32' ? 'git.exe' : 'git')
const PATH_NODE = resolveGateExecutable(process.platform === 'win32' ? 'node.exe' : 'node')
// Scheduled courts invoke these names through PATH. Their resolved presence,
// path and bytes are re-measured before every run, including optional
// platform tools whose absence affects a verdict.
const COURT_PATH_EXECUTABLES = Object.freeze(process.platform === 'win32'
  ? ['git.exe', 'node.exe', 'pnpm.cmd', 'python.exe']
  : ['bash', 'dscl', 'git', 'launchctl', 'lsof', 'node', 'pnpm', 'ps', 'python3', 'setpriv', 'sudo'])
// One court intentionally bypasses PATH for ps, while another probes these
// fixed setpriv locations. Presence and absence are both evidence.
const COURT_ABSOLUTE_EXECUTABLES = Object.freeze(process.platform === 'win32'
  ? []
  : ['/bin/ps', '/usr/bin/setpriv', '/bin/setpriv'])
const gitArgs = (...args) => [
  '-c', 'core.fsmonitor=false',
  '-c', 'core.untrackedCache=false',
  '-c', `core.excludesFile=${NULL_DEVICE}`,
  ...args,
]
const RUNTIME_PROFILE = '8088-inside-out'
const RUNTIME_CONFIG = join(ROOT, 'profiles', RUNTIME_PROFILE, 'cordis.yml')
const RUNTIME_FALLBACK = join(ROOT, 'profiles', 'node_modules')
const RUNTIME_CLI = join(ROOT, 'apps', 'cli', 'lib', 'bin.js')
const runIdentity = (label, path, args) => `${label}|${path}|${JSON.stringify(args)}`

// Sixteen production courts grade aukora/: every non-WYSIWYS court runs its
// ordinary and generic mutation modes. Aura record additionally runs one arm
// for each reader predicate, while wysiwys-issuer runs four named mutations.
const courts_dual = ['verifier-bytes', 'broker', 'settlement', 'aura-record', 'aura-consistency', 'spine', 'wasm-proposal-cell', 'guest-import-purity', 'kernel-hardening', 'identity-core', 'confinement', 'uid-confinement', 'live-dispatch', 'intent-reconciliation', 'amendment-channel', 'compute-job', 'receipt-v3', 'receipt-inspect']
const SKIP_STATUS = 77
const dualModes = [
  { label: 'normal', args: [] },
  { label: 'mutation', args: ['--mutate'] },
]
const auraRecordModes = [
  ...dualModes,
  { label: 'revert-line-encoding', args: ['--arm=revert-line-encoding'] },
  { label: 'revert-reserved-field', args: ['--arm=revert-reserved-field'] },
]
const ordinaryModes = (court) => court === 'aura-record' ? auraRecordModes : dualModes
const wysiwysModes = [
  { label: 'normal', args: [] },
  { label: 'semantic-body', args: ['--mutate'] },
  { label: 'rider', args: ['--mutate-rider'] },
  { label: 'fixed-field', args: ['--mutate-fields'] },
  { label: 'mint-drift', args: ['--mutate-mint-drift'] },
]
const expectation = (rows, options = {}) => {
  const breach = options.breach ?? []
  const kept = options.kept ?? []
  return {
    breach,
    held: rows.filter(row => !breach.includes(row) && !kept.includes(row)),
    kept,
    status: options.status ?? 0,
    terminal: options.terminal,
    requiredStdout: options.requiredStdout ?? [],
    allowedStderrPrefixes: options.allowedStderrPrefixes ?? [],
    stderrExact: options.stderrExact,
  }
}
const VITE_TSCONFIG_PATHS_WARNING = 'The plugin "vite-tsconfig-paths" is detected. Vite now supports tsconfig paths resolution natively via the resolve.tsconfigPaths option. You can remove the plugin and set resolve.tsconfigPaths: true in your Vite config instead.'
const COMPUTE_JOB_ROWS = ['J1.staged', 'J2.pin', 'J3.definition-id', 'J4.grammar', 'J5.approval', 'J6.preflight', 'J7.neighbours']
const VERIFIER_ROWS = ['V1.live', 'V2.format', 'V2.roots', 'V2.nodes', 'V2.local-edges', 'V2.external-edges', 'V2.bytes', 'V2.recompute']
const BROKER_ROWS = [
  ...Array.from({ length: 46 }, (_, index) => `B${index + 1}`),
  'P1',
]
const SETTLEMENT_ROWS = ['S1', 'S2', 'S3', 'S4', 'S4-control', 'S6-rsa512', 'S6-ec224', 'S6-private', 'S5-unobservable', 'S5', 'S6', 'S7']
const AURA_ROWS = [
  ...Array.from({ length: 10 }, (_, index) => `R${index + 1}`),
  'E1.honest', 'E2.decoy-first', 'E3.decoy-last', 'E4.padding', 'E5.number',
  'E6.reserved',
]
const AURA_CONSISTENCY_ROWS = [
  'C1.extension', 'C2.power-prefix', 'C3.same', 'C4.proof-mutated',
  'C5.proof-truncated', 'C6.proof-extra', 'C7.namespace', 'C8.commitment',
  'C9.same-size-conflict', 'C10.regression', 'C11.prefix-conflict',
  'C12.power-prefix-limit', 'C13.duplicate-field',
  'C14.ceiling', 'C15.original-minimal',
]
const SPINE_ROWS = ['E1', 'E2', 'E3', 'C1', 'C2', 'M1', 'M2']
const WASM_PROPOSAL_ROWS = [
  'W0.sources',
  'W1.proposal', 'W2.determinism', 'W3.exact', 'W4.key', 'W5.size',
  'W6.absent-namespace', 'W7.absent-import', 'W8.widening-control',
  'W9.range', 'W10.utf8', 'W11.json', 'W12.canonical',
]
const GUEST_IMPORT_ROWS = [
  'G1.roots', 'G2.aukora', 'G3.types', 'G4.dynamic', 'G5.builtins', 'G6.forbidden-builtins', 'G7.definition',
]
const KERNEL_ROWS = ['K6', 'K1', 'K1-index', 'K1-size', 'K1-malformed', 'K1-vector', 'M1', 'M2', 'M3', 'K2', 'K3-control', 'K3-extra', 'K3-type', 'K3-closure', 'K4', 'K5']
const IDENTITY_ROWS = [
  'I1.vector', 'I2.closed', 'I3.commitments',
  'D1.attenuation', 'D2.parent', 'D3.subject-control', 'D4.sets',
  'D5.budgets', 'D6.time', 'D7.role', 'D8.strict', 'D9.serialized',
]
const CONFINEMENT_ROWS = ['C1', 'C5', 'C6', 'C7', 'C8', 'C9', 'C2', 'C3', 'C4', 'C10', 'C16', 'C11', 'C12', 'C13', 'C14', 'C18', 'C17', 'C15', 'C19']
const UID_ROWS = Array.from({ length: 7 }, (_, index) => `L${index + 1}`)
const INTENT_ROWS = Array.from({ length: 8 }, (_, index) => `R${index + 1}`)
const AMENDMENT_ROWS = Array.from({ length: 10 }, (_, index) => `A${index + 1}`)
const RECEIPT_INSPECT_ROWS = [
  'I1.malformed-identifier', 'I2.not-found', 'I3.settled-with-v1-only',
  'I4.settled-with-v3-unattributed', 'I5.missing-trust-input-refuses-grant',
  'I6.evidence-mismatch', 'I7.read-only', 'I8.socket-op-reaches-it',
  'I9.artifact-bytes-are-original',
]
const RECEIPT_V3_ROWS = [
  'V3.import-purity', 'V3.fixture', 'V3.class-kind', 'V3.human-refused', 'V3.canonical-parity', 'V3.cold',
  'V3.export-roundtrip', 'V3.original-untouched', 'V3.settlement-refused',
  'V3.live-settlement-export', 'V3.second-settlement', 'V3.export-failure-handling',
]
const WYSIWYS_ROWS = ['W1.key-alphabet', 'W2.bidi', 'W3.invisible', 'W4.ansi', 'W11.ascii', 'W5.multiline', 'W7.one-renderer', 'W8.effect-body', 'W12.fields', 'W9.omitted-value', 'W9.rider-key', 'W10.denial', 'W6.digest-signed', 'W13.mint-drift']
const ordinaryExpectations = new Map([
  ['verifier-bytes', expectation(VERIFIER_ROWS, { terminal: { exact: 'observationClass: SELF-REPORTED' } })],
  ['verifier-bytes --mutate', expectation(VERIFIER_ROWS, {
    terminal: { exact: 'MUTATION sourceBytesApplied=38/38 sourceBytesMoved=38/38 importRewireApplied=true importRewireMoved=true importRewireGraphHeld=true sabotagedLiveRejected=true detected=true  DETECTED' },
  })],
  ['compute-job', expectation(COMPUTE_JOB_ROWS, { terminal: { exact: 'observationClass: SELF-REPORTED' } })],
  ['compute-job --mutate', expectation(COMPUTE_JOB_ROWS, {
    terminal: { exact: 'MUTATION definition-drift  executorByteAppended=true driftRefused=true repinnedIdMoved=true outstandingApprovalRetired=true repinnedPreflightHeld=true unrelatedApprovalKept=true sabotagedRejected=true detected=true  DETECTED' },
  })],
  ['broker', expectation(BROKER_ROWS, { terminal: { exact: 'observationClass: SELF-REPORTED' } })],
  ['broker --mutate', expectation(BROKER_ROWS, { breach: ['B1', 'B5', 'P1'], terminal: { exact: 'breached=[B1 B5 P1]  DETECTED' } })],
  ['settlement', expectation(SETTLEMENT_ROWS, { terminal: { exact: 'observationClass: SELF-REPORTED' } })],
  ['settlement --mutate', expectation(SETTLEMENT_ROWS, { terminal: { exact: 'MUTATION production observation bypass  anchorApplied=true premintedAdmitted=true ordinaryRowsHeld=true  DETECTED' } })],
  ['aura-record', expectation(AURA_ROWS, { kept: ['R8'], terminal: { exact: 'observationClass: SELF-REPORTED' } })],
  ['aura-record --mutate', expectation(AURA_ROWS, { kept: ['R8'], terminal: { exact: 'MUTATION chain integrity  ordinaryHeld=true  tamperDetected=true truncationDetected=true  sabotagedOrdinaryRejected=true  DETECTED' } })],
  ['aura-record --arm=revert-line-encoding', expectation(AURA_ROWS, {
    breach: ['E2.decoy-first', 'E3.decoy-last', 'E4.padding', 'E5.number'],
    kept: ['R8'],
    status: 1,
    terminal: { exact: "MUTATION arm 'revert-line-encoding'  predicateDeleted=true  reddened=[E2.decoy-first E3.decoy-last E4.padding E5.number]  required=[E2.decoy-first E3.decoy-last E4.padding E5.number]  MUTATION CONFIRMED" },
  })],
  ['aura-record --arm=revert-reserved-field', expectation(AURA_ROWS, {
    breach: ['E6.reserved'],
    kept: ['R8'],
    status: 1,
    terminal: { exact: "MUTATION arm 'revert-reserved-field'  predicateDeleted=true  reddened=[E6.reserved]  required=[E6.reserved]  MUTATION CONFIRMED" },
  })],
  ['aura-consistency', expectation(AURA_CONSISTENCY_ROWS, {
    terminal: { exact: 'observationClass: COLD-INDEPENDENT-PROGRAM / RETENTION-LOCATION-NOT-ESTABLISHED' },
  })],
  ['aura-consistency --mutate', expectation(AURA_CONSISTENCY_ROWS, {
    terminal: { exact: 'MUTATION sourceReplacement=true conflictAccepted=true ordinaryRowsHeld=true  DETECTED' },
  })],
  ['spine', expectation(SPINE_ROWS, { terminal: { exact: 'observationClass: SELF-REPORTED' } })],
  ['spine --mutate', expectation(SPINE_ROWS, {
    breach: ['M1'],
    terminal: { exact: 'MUTATION compareObjectInventory bypassed  anchorApplied=true rowsComplete=true expected=7 observed=7 orphanSurvived=true mutantReported=false unrelatedBreaches=[]  DETECTED' },
  })],
  ['wasm-proposal-cell', expectation(WASM_PROPOSAL_ROWS, {
    terminal: { exact: 'observationClass: WASM-IMPORT-INVENTORY-PINNED / ALLOWED-HOST-CALLBACK-AUDITED / NODE-EMBEDDER-UNCONFINED' },
  })],
  ['wasm-proposal-cell --mutate', expectation(WASM_PROPOSAL_ROWS, {
    terminal: { exact: 'MUTATION wasm import and host validation controls  inventoryApplied=true controlRefused=true widenedModuleAdmitted=true ambientCalled=true validationApplied=true rangeDiagnosticLost=true invalidUtf8Admitted=true jsonDiagnosticLost=true noncanonicalAdmitted=true allowedEffectApplied=true allowedEffectReached=true ordinaryRowsHeld=true  DETECTED' },
  })],
  ['guest-import-purity', expectation(GUEST_IMPORT_ROWS, {
    terminal: { exact: 'observationClass: STATIC-IMPORT-SEPARATION / NODE-GUEST-UNCONFINED' },
  })],
  ['guest-import-purity --mutate', expectation(GUEST_IMPORT_ROWS, {
    breach: ['G1.roots', 'G2.aukora', 'G4.dynamic', 'G5.builtins', 'G6.forbidden-builtins'],
    terminal: { exact: 'MUTATION definition import rewire and cell bypass  applied=true effectReached=true bareFsApplied=true builtinModuleApplied=true ancestorSymlinkApplied=true cellBypassApplied=true cellReachedNormally=true cellReachedAfterBypass=false fsReached=true normalHeld=true expectedBreaches=[G1.roots G2.aukora G4.dynamic G5.builtins G6.forbidden-builtins] matched=true  DETECTED' },
  })],
  ['kernel-hardening', expectation(KERNEL_ROWS, { terminal: { exact: 'ALL HELD.' } })],
  ['kernel-hardening --mutate', expectation(KERNEL_ROWS, { terminal: { exact: 'MUTATION verifier accepts a pre-hashed leaf  internalNodeAdmitted=true ordinaryRowsHeld=true  DETECTED' } })],
  ['identity-core', expectation(IDENTITY_ROWS, {
    terminal: { exact: 'observationClass: IDENTITY-PRIMITIVES-ONLY / UNSIGNED-DELEGATION-GRANTS-NO-AUTHORITY' },
  })],
  ['identity-core --mutate', expectation(IDENTITY_ROWS, {
    terminal: { exact: 'MUTATION operation attenuation guard  sourceApplied=true controlRefused=true widenedChildAdmitted=true ordinaryRowsHeld=true  DETECTED' },
  })],
  ['confinement', expectation(CONFINEMENT_ROWS, { terminal: { exact: 'observationClass: SELF-REPORTED' } })],
  ['confinement --mutate', expectation(CONFINEMENT_ROWS, {
    terminal: { exact: 'MUTATION ordinary-row oracle      ordinaryRowsHeld=true' },
    requiredStdout: [
      '  MUTATION boot refusal deleted     0777 dir served, stamped "unconfined"   DETECTED',
      '  MUTATION class gate deleted       unconfined receipt admitted=true   DETECTED',
      '  MUTATION seal ratchet deleted     "peer-separated" dir reached effect with "INDETERMINATE"   DETECTED',
    ],
  })],
  ['uid-confinement', process.platform === 'linux'
    ? expectation(UID_ROWS, { terminal: { exact: 'observationClass: SELF-REPORTED' } })
    : expectation([], { status: SKIP_STATUS, terminal: { exact: 'observationClass: SKIP (platform-gated)' } })],
  ['uid-confinement --mutate', process.platform === 'linux'
    ? expectation(UID_ROWS, {
      breach: ['L2', 'L3', 'L4', 'L5', 'L6', 'L7'],
      terminal: { exact: 'MUTATION confinement removed (state 0777)  stateReached=true expectedBreaches=[L2 L3 L4 L5 L6 L7] ordinaryRowsMatched=true  DETECTED' },
    })
    : expectation([], { status: SKIP_STATUS, terminal: { exact: 'observationClass: SKIP (platform-gated)' } })],
  ['live-dispatch', expectation([], {
    terminal: { prefix: 'NORMAL {"spec":"packages/governed/memory-put/tests/loader-profile.spec.ts"', suffix: '"exact":true}' },
    stderrExact: Array.from({ length: 6 }, () => VITE_TSCONFIG_PATHS_WARNING),
  })],
  ['live-dispatch --mutate', expectation([], {
    terminal: { exact: '}' },
    stderrExact: Array.from({ length: 3 }, () => VITE_TSCONFIG_PATHS_WARNING),
  })],
  ['intent-reconciliation', expectation(INTENT_ROWS, {
    terminal: { exact: 'INTENT RECONCILIATION HOLDS.' },
    allowedStderrPrefixes: ['broker:intent-unresolved ', 'broker:intent-malformed '],
  })],
  ['intent-reconciliation --mutate', expectation(INTENT_ROWS, {
    terminal: { exact: 'MUTATION unresolved startup refusal removed  anchorApplied=true rowsComplete=true expected=8 observed=8 fixture={"orphaned":["pending-mutation"],"malformed":[]} served=true reason=null unrelatedBreaches=[]  DETECTED' },
    allowedStderrPrefixes: ['broker:intent-unresolved ', 'broker:intent-malformed '],
  })],
  ['amendment-channel', expectation(AMENDMENT_ROWS, { terminal: { exact: 'observationClass: SELF-REPORTED' } })],
  ['amendment-channel --mutate', expectation(AMENDMENT_ROWS, {
    terminal: { exact: 'MUTATION ordinary-row oracle       expectedBreaches=[] matched=true' },
  })],
  ['receipt-v3', expectation(RECEIPT_V3_ROWS, { terminal: { exact: 'observationClass: SELF-REPORTED' } })],
  ['receipt-inspect', expectation(RECEIPT_INSPECT_ROWS, { terminal: { exact: 'observationClass: SELF-REPORTED' } })],
  ['receipt-inspect --mutate', expectation(RECEIPT_INSPECT_ROWS, {
    terminal: { exact: 'MUTATION tamperedReceipt  tamperCaught=true sabotagedRejected=true detected=true  DETECTED' },
  })],
  ['receipt-v3 --mutate', expectation(RECEIPT_V3_ROWS, {
    terminal: { exact: 'MUTATION field-flip  fields=34/34 refusedByName=34/34 sabotagedRejected=true detected=true  DETECTED' },
  })],
  ['wysiwys-issuer normal', expectation(WYSIWYS_ROWS, { terminal: { exact: 'observationClass: SELF-REPORTED' } })],
  ['wysiwys-issuer semantic-body', expectation(WYSIWYS_ROWS, { breach: ['W2.bidi', 'W3.invisible', 'W11.ascii', 'W5.multiline', 'W7.one-renderer', 'W8.effect-body', 'W12.fields'], terminal: { exact: 'breached=[W2.bidi W3.invisible W11.ascii W5.multiline W7.one-renderer W8.effect-body W12.fields]  DETECTED' } })],
  ['wysiwys-issuer rider', expectation(WYSIWYS_ROWS, { breach: ['W9.omitted-value', 'W9.rider-key'], terminal: { exact: 'breached=[W9.omitted-value W9.rider-key]  DETECTED' } })],
  ['wysiwys-issuer fixed-field', expectation(WYSIWYS_ROWS, { breach: ['W7.one-renderer', 'W12.fields'], terminal: { exact: 'breached=[W7.one-renderer W12.fields]  DETECTED' } })],
  ['wysiwys-issuer mint-drift', expectation(WYSIWYS_ROWS, { breach: ['W6.digest-signed', 'W13.mint-drift'], terminal: { exact: 'breached=[W6.digest-signed W13.mint-drift]  DETECTED' } })],
])
// `organism` and the historical `test/*.mjs` suites import archive/lab/
// directly. They remain runnable laboratory exercises, but this production
// gate neither runs nor tallies them as evidence for aukora/.

// The known-breach lane. Its enrollment is DATA, owned by the oracle, and lives
// under courts/ — outside the builder's tree — because a builder who can edit
// the enrollment can retire a breach by editing a file, which is the one thing
// this lane exists to make impossible.
const MANIFEST_PATH = join(ROOT, 'courts', 'known-breaches.json')

// Exit code 77 is the court's honest "skipped by design" verdict: uid-confinement
// needs a real second uid and setuid, so it skips off Linux. Skips are counted
// separately — they neither pass the gate nor masquerade as green. The
// `confinement` court is the one that runs everywhere: it grades the boot
// refusal and the signed confinement class on both platforms, and on a Mac it
// measures a truthful `state-owned` rather than skipping.
// Exit code 78 is an honest "the court ran, but at least one required subject
// was absent or unobservable" verdict. It is neither a pass nor a breach. The
// gate preserves it so missing evidence cannot be laundered into either lane.
const INCONCLUSIVE_STATUS = 78
const BUILD_TIMEOUT_MS = 5 * 60 * 1000
const PREPARATION_TIMEOUT_MS = 2 * 60 * 1000
// The selected files can serialize on a one-worker runner: the preset file has
// two two-minute setup hooks, the browser row has a four-minute ceiling, and
// the assembled file must also finish before teardown. Eleven minutes keeps
// the wrapper outside those declared lanes while retaining a finite kill.
const PARENT_LAUNCH_TIMEOUT_MS = 11 * 60 * 1000
const ORDINARY_TIMEOUT_MS = 3 * 60 * 1000
// Both guest entrypoints execute live watcher and executable-config controls.
const ordinaryTimeoutMs = court => court === 'amendment-channel' ? 900000 : ORDINARY_TIMEOUT_MS

// Several courts deliberately execute the shipped CLI and package entrypoints,
// rather than source through the TypeScript resolver. The parent Web assembly
// also resolves client package entrypoints through their built `lib/` trees. A
// fresh checkout has neither artifact plane, so the gate prepares both before
// it starts counting court results. Otherwise a missing build can look like a
// court failure or an unsupported-subject skip instead of a failed prerequisite.
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const PNPM_PATH = resolveGateExecutable(pnpmCommand)
const buildArtifactPlane = () => {
  console.log('\n  BUILD PRECONDITION — preparing Host and Client runtime artifacts')
  const result = spawnSync(PNPM_PATH, ['run', 'build:lib'], {
    cwd: ROOT,
    env: GATE_BUILD_ENV,
    stdio: 'inherit',
    timeout: BUILD_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  })
  if (result.error !== undefined) {
    console.error(`\n  *** GATE PRECONDITION FAILED *** could not start ${pnpmCommand}: ${String(result.error.message)}`)
    process.exit(1)
  }
  if (result.signal !== null || result.status !== 0) {
    console.error(`\n  *** GATE PRECONDITION FAILED *** build:lib ${result.signal === null ? `exited ${result.status}` : `was killed by ${result.signal}`}`)
    process.exit(1)
  }
}

const runParentLaunchAssembly = () => {
  console.log('\n  ASSEMBLY PRECONDITION — exercising the parent-owned governed source launch')
  const webBuild = spawnSync(PNPM_PATH, ['--filter', '@deepseek-ai/dsh-web-frontend', 'build'], {
    cwd: ROOT,
    env: GATE_BUILD_ENV,
    stdio: 'inherit',
    timeout: BUILD_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  })
  if (webBuild.error !== undefined || webBuild.signal !== null || webBuild.status !== 0) {
    const detail = webBuild.error !== undefined
      ? String(webBuild.error.message)
      : webBuild.signal === null ? `exited ${String(webBuild.status)}` : `was killed by ${webBuild.signal}`
    console.error(`\n  *** GATE PRECONDITION FAILED *** Web build ${detail}`)
    process.exit(1)
  }
  const result = spawnSync(PNPM_PATH, [
    'exec',
    'vitest',
    'run',
    '--config',
    'vitest.aukora-parent-launch.config.ts',
  ], {
    cwd: ROOT,
    env: GATE_ENV,
    stdio: 'inherit',
    timeout: PARENT_LAUNCH_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  })
  if (result.error !== undefined) {
    // A budget kill reports the same `error` slot as a failed spawn. Reporting
    // both as "did not start" mislabels a lane that ran to the budget.
    console.error(`\n  *** GATE PRECONDITION FAILED *** parent launch ${result.error.code === 'ETIMEDOUT'
      ? `ran past its ${PARENT_LAUNCH_TIMEOUT_MS} ms budget and was killed by ${result.signal ?? 'SIGKILL'}`
      : `did not start: ${String(result.error.message)}`}`)
    process.exit(1)
  }
  if (result.signal !== null || result.status !== 0) {
    console.error(`\n  *** GATE PRECONDITION FAILED *** parent launch ${result.signal === null ? `exited ${result.status}` : `was killed by ${result.signal}`}`)
    process.exit(1)
  }
}

// These are the only ordinary runs whose subject genuinely requires Linux
// setuid support. A self-selected 77 anywhere else is a missing measurement,
// not an honest platform skip.
const SKIPPABLE_ORDINARY_RUNS = new Set([
  'uid-confinement',
  'uid-confinement --mutate',
])

// ---------------------------------------------------------------------------
// THE RUNNER-ISSUED CHALLENGE.
//
// Every other check in this lane reads the court's own output. That
// authenticates the SHAPE of a verdict, never the MEASUREMENT behind it: a
// court that catches its own setup failure, prints a plausible verdict table
// and exits 1 satisfies the sentinel, the stderr budget, the row split and the
// git witness at once, because nothing it printed was ever required to have
// come from the filesystem.
//
// The challenge is the one check a fabricating court cannot answer. Before the
// court is spawned the gate creates a file with a RANDOM name inside a
// directory that court's enumeration must sweep, never tells the court the
// name, and then requires the name to appear in the court's stdout. A court
// that did not really walk that directory cannot print a string it never read.
// An enrollment whose enumeration exists only after one shipped launch may
// name a closed runner preparation. The runner first proves its generated
// paths absent, invokes that reviewed launcher, then plants and later removes
// the nonce before deleting only the state it created.
//
// THE NONCE TRAVELS THROUGH THE FILESYSTEM, NEVER THROUGH THE ENVIRONMENT OR
// ARGV. A court handed the nonce in a variable could echo it while measuring
// nothing, which is exactly the forgery this exists to catch.
//
// WHAT IT DOES NOT PROVE — and this is the honest limit, not a caveat. A passed
// challenge proves the court REACHED the filesystem it claims to sweep. It does
// not prove the court REPORTED that sweep faithfully. A court that really
// enumerates, prints the planted name, and then prints a fabricated verdict
// table still passes every check here. The only real guarantee remains LANE
// SEPARATION — the builder cannot edit courts/ — and a court author can still
// lie. This closes one hole; it does not make the lane self-authenticating.
//
// `dangling-symlink` is the plant kind for a sweep that records symlinks (the
// flat-fallback walk in composition-closure does); `empty-file` is for a sweep
// that records regular files. The kind is enrolled per challenge because a
// plant the court's walk does not record would fail the gate for the gate's own
// reason, which is a false alarm, not a proof.
const PLANT_KINDS = new Set(['dangling-symlink', 'empty-file'])
// A preparation is a named runner-owned fixture, never an enrollment-provided
// shell command. Each value maps to one reviewed shipped entrypoint below.
const RUNNER_PREPARATIONS = new Set(['profile-module-fallback'])
const CHALLENGE_PREFIX = '.aukora-runner-challenge-'
const DANGLING_TARGET = './__aukora-runner-challenge-has-no-target__'
const GIT_WITNESS_MAX_BUFFER = 8 * 1024 * 1024

let okCount = 0
let skipCount = 0
let inconclusiveCount = 0
let red = 0
let breachCount = 0
let resolvedCount = 0
let keptBreachRunCount = 0
let mutationDetectedCount = 0
const unexpected = []
const inconclusiveCourts = []
const keptBreachRowsByCourt = new Map()
const observedRunRoster = []
const classifiedRuns = new Map()
const runResults = new Map()
const duplicateClassifications = new Set()
const recordClassification = (
  identity,
  classification,
  result,
  processDurationMs = 0,
  armStarted = performance.now(),
  faults = [],
) => {
  if (classifiedRuns.has(identity)) duplicateClassifications.add(identity)
  else {
    classifiedRuns.set(identity, classification)
    runResults.set(identity, {
      durationMs: Math.max(0, Math.round(performance.now() - armStarted)),
      process: courtGateProcessResult(result, processDurationMs),
      faultCount: faults.length,
    })
  }
}
const tally = (
  court,
  label,
  identity,
  result,
  processDurationMs,
  armStarted,
  runnerFaults = [],
  counterfactual = false,
) => {
  const rows = parseCourtRows(result.stdout ?? '')
  const expected = ordinaryExpectations.get(label)
  const expectedKeptRows = keptBreachRowsByCourt.get(court) ?? []
  const faults = [...runnerFaults]
  if (expected === undefined) faults.push('ordinary run has no fixed evidence declaration')
  if (result.error?.code === 'ETIMEDOUT') faults.push(`TIMED OUT after ${ordinaryTimeoutMs(court)} ms`)
  else if (result.error !== undefined) faults.push(`could not execute: ${String(result.error.message)}`)
  if (result.signal !== null && result.signal !== undefined) faults.push(`killed by signal ${result.signal}`)
  if (rows.duplicateIds.length > 0) faults.push(`duplicate row ids: ${rows.duplicateIds.join(', ')}`)
  if (expected !== undefined) {
    const compare = (name, expectedRows, observedRows) => {
      const missing = expectedRows.filter(row => !observedRows.has(row))
      const extra = [...observedRows].filter(row => !expectedRows.includes(row)).sort()
      if (missing.length > 0) faults.push(`${name} rows missing: ${missing.join(', ')}`)
      if (extra.length > 0) faults.push(`${name} rows added: ${extra.join(', ')}`)
    }
    const expectedAll = [...expected.held, ...expected.breach, ...expected.kept]
    const observedAll = new Set([...rows.held, ...rows.breach, ...rows.keptBreach, ...rows.inconclusive])
    compare('ordinary', expectedAll, observedAll)
    if (result.status === INCONCLUSIVE_STATUS) {
      if (rows.unparsedLines.length > 0) faults.push(`unparseable court rows at lines: ${rows.unparsedLines.join(', ')}`)
      if (rows.inconclusive.size === 0) faults.push(`exit ${INCONCLUSIVE_STATUS} requires an inconclusive row`)
      for (const [name, expectedRows, observedRows] of [
        ['held', expected.held, rows.held],
        ['breach', expected.breach, rows.breach],
        ['kept-breach', expected.kept, rows.keptBreach],
      ]) {
        const changed = [...observedRows].filter(row => !expectedRows.includes(row)).sort()
        if (changed.length > 0) faults.push(`${name} verdict changed for rows: ${changed.join(', ')}`)
      }
    } else {
      faults.push(...ordinaryResultFaults(expected, rows))
      if (result.status !== expected.status) faults.push(`exited ${result.status}, expected ${expected.status}`)
    }
    faults.push(...keptBreachFaults(expected.kept, new Set(expectedKeptRows)))
    const stdout = result.stdout ?? ''
    if (label === 'live-dispatch') faults.push(...liveDispatchNormalFaults(stdout, ROOT))
    if (label === 'live-dispatch --mutate') faults.push(...liveDispatchMutationFaults(stdout))
    if (label === 'amendment-channel --mutate') faults.push(...amendmentChannelMutationFaults(stdout))
    for (const token of expected.requiredStdout) {
      if (!stdout.includes(token)) faults.push(`required stdout evidence absent: ${JSON.stringify(token)}`)
    }
    const stderrLines = (result.stderr ?? '').split('\n').filter(line => line !== '')
    if (expected.stderrExact !== undefined) {
      if (stderrLines.length !== expected.stderrExact.length
        || stderrLines.some((line, index) => line !== expected.stderrExact[index])) {
        faults.push(`stderr lines were not the exact declared ${expected.stderrExact.length}-line transcript`)
      }
    } else {
      for (const line of stderrLines) {
        if (!expected.allowedStderrPrefixes.some(prefix => line.startsWith(prefix))) {
          faults.push(`unexpected stderr line: ${JSON.stringify(line)}`)
        }
      }
    }
    const terminalLine = stdout.split('\n').filter(line => line.trim() !== '').pop()?.trim() ?? ''
    const terminalAssignments = [...terminalLine.matchAll(/\b([a-z][A-Za-z0-9]*)=([^\s]+)/g)]
    const terminalKeys = new Set()
    for (const assignment of terminalAssignments) {
      if (terminalKeys.has(assignment[1])) faults.push(`terminal stdout repeats assignment ${JSON.stringify(assignment[1])}`)
      terminalKeys.add(assignment[1])
    }
    if (expected.terminal?.exact !== undefined && terminalLine !== expected.terminal.exact) {
      faults.push(`stdout terminated with ${JSON.stringify(terminalLine)}, expected ${JSON.stringify(expected.terminal.exact)}`)
    }
    if (expected.terminal?.prefix !== undefined && !terminalLine.startsWith(expected.terminal.prefix)) {
      faults.push(`terminal stdout lacks prefix ${JSON.stringify(expected.terminal.prefix)}`)
    }
    if (expected.terminal?.suffix !== undefined && !terminalLine.endsWith(expected.terminal.suffix)) {
      faults.push(`terminal stdout lacks suffix ${JSON.stringify(expected.terminal.suffix)}`)
    }
  }
  if (faults.length > 0) {
    recordClassification(identity, 'unexpected', result, processDurationMs, armStarted, faults)
    red++
    unexpected.push(`${label} (${faults.join('; ')})`)
    console.log(`FAIL  ${label} (${faults.join('; ')})`)
    return
  }
  const status = result.status
  if (status === INCONCLUSIVE_STATUS) {
    recordClassification(identity, 'inconclusive', result, processDurationMs, armStarted)
    inconclusiveCount++
    inconclusiveCourts.push(label)
    console.log(`UNVERIFIED  ${label}`)
  } else if (expected.kept.length > 0) {
    recordClassification(identity, 'kept-breach', result, processDurationMs, armStarted)
    keptBreachRunCount++
    console.log(`KEPT BREACH  ${label} (${expectedKeptRows.join(', ')})`)
  } else if (status === SKIP_STATUS && SKIPPABLE_ORDINARY_RUNS.has(label)) {
    recordClassification(identity, 'skip', result, processDurationMs, armStarted)
    skipCount++
    console.log(`SKIP  ${label}`)
  } else if (counterfactual) {
    recordClassification(identity, 'counterfactual', result, processDurationMs, armStarted)
    mutationDetectedCount++
    console.log(`COUNTERFACTUAL DETECTED  ${label}`)
  } else {
    recordClassification(identity, 'pass', result, processDurationMs, armStarted)
    okCount++
    console.log(` ok   ${label}`)
  }
}

// ---------------------------------------------------------------------------
// Enrollment. Every defect here is a misconfiguration, and misconfiguration
// fails loud at load: an enrollment that names a file which does not exist is
// the exact failure mode a known-breach lane must never paper over.
// ---------------------------------------------------------------------------
const die = (message) => {
  console.error(`\n  *** ENROLLMENT REJECTED ***  ${MANIFEST_PATH}\n  ${message}\n`)
  process.exit(1)
}
if (!existsSync(MANIFEST_PATH)) die('the known-breach enrollment manifest is missing; the gate will not run without it')
let manifest
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
} catch (error) {
  die(`the manifest is not valid JSON: ${String(error?.message ?? error)}`)
}
if (manifest?.schemaVersion !== 3) die('schemaVersion must be 3')
const enrolled = manifest.knownBreaches
if (!Array.isArray(enrolled)) die('knownBreaches must be an array')
const registeredElsewhere = new Set([...courts_dual, 'wysiwys-issuer'])
const ROW_ID = /^[A-Z]{1,3}\d{1,3}(?:[.-][a-z0-9]+)*$/
const MUTATION_VERDICTS = new Set(['DETECTED', 'HELD'])
const PLATFORM_SKIP_VERDICTS = new Set([...MUTATION_VERDICTS, 'NOT DETECTED', 'NOT HELD'])
const PLATFORM_NAMES = new Set(['darwin', 'linux', 'win32'])
const ADDITIONAL_CLASSIFICATIONS = new Set(['known-breach', 'skip'])
const seen = new Set()
const keptBreachRows = manifest.keptBreachRows
if (!Array.isArray(keptBreachRows)) die('keptBreachRows must be an array')
const seenKeptRows = new Set()
for (const entry of keptBreachRows) {
  const at = `keptBreachRows entry ${JSON.stringify(entry)}`
  if (typeof entry?.court !== 'string' || !courts_dual.includes(entry.court)) {
    die(`${at}: court must name an ordinary dual-mode court`)
  }
  if (typeof entry.row !== 'string' || !ROW_ID.test(entry.row)) die(`${at}: row must be one valid row id`)
  const key = `${entry.court}:${entry.row}`
  if (seenKeptRows.has(key)) die(`${at}: enrolled twice`)
  seenKeptRows.add(key)
  const rows = keptBreachRowsByCourt.get(entry.court) ?? []
  rows.push(entry.row)
  keptBreachRowsByCourt.set(entry.court, rows)
}

/** Validate one enrolled row list before it can be compared with court output. */
const expectedRowIds = (at, name, value, requireOne) => {
  if (!Array.isArray(value) || (requireOne && value.length === 0)) {
    die(`${at}: ${JSON.stringify(name)} must be ${requireOne ? 'a non-empty' : 'an'} array`)
  }
  const ids = new Set()
  for (const id of value) {
    if (typeof id !== 'string' || !ROW_ID.test(id)) {
      die(`${at}: ${JSON.stringify(name)} contains invalid row id ${JSON.stringify(id)}`)
    }
    if (ids.has(id)) die(`${at}: ${JSON.stringify(name)} names ${id} more than once`)
    ids.add(id)
  }
  return ids
}

/** Validate exact mutation result declarations and return their marker names. */
const expectedMutationVerdicts = (at, value, allowedVerdicts) => {
  if (!Array.isArray(value) || value.length === 0) {
    die(`${at}: expectedVerdicts must be a non-empty array`)
  }
  const mutationMarkers = new Set()
  const mutationDetails = []
  for (const verdict of value) {
    if (typeof verdict !== 'object' || verdict === null || Array.isArray(verdict)) {
      die(`${at}: mutation verdict must be an object`)
    }
    const unknownKeys = Object.keys(verdict).filter((key) => !['detailExact', 'marker', 'verdict'].includes(key))
    if (unknownKeys.length > 0) {
      die(`${at}: mutation verdict contains unknown keys: ${unknownKeys.sort().join(', ')}`)
    }
    if (typeof verdict.marker !== 'string' || verdict.marker.trim() === ''
      || verdict.marker !== verdict.marker.trim() || /[\r\n]/.test(verdict.marker)) {
      die(`${at}: mutation verdict marker must be a non-empty string`)
    }
    if (verdict.detailExact !== undefined
      && (typeof verdict.detailExact !== 'string' || verdict.detailExact.trim() === ''
        || verdict.detailExact !== verdict.detailExact.trim() || /[\r\n]/.test(verdict.detailExact))) {
      die(`${at}: mutation detailExact must be a non-empty trimmed single-line string when present`)
    }
    if (!allowedVerdicts.has(verdict.verdict)) {
      die(`${at}: mutation verdict for ${JSON.stringify(verdict.marker)} is not allowed here`)
    }
    if (mutationMarkers.has(verdict.marker)) die(`${at}: mutation marker ${JSON.stringify(verdict.marker)} appears twice`)
    mutationMarkers.add(verdict.marker)
    if (verdict.detailExact !== undefined) {
      const detail = `${verdict.marker} ${verdict.detailExact}`
      const declared = mutationDetails.find(candidate => candidate.detail === detail)
      if (declared !== undefined) {
        die(`${at}: mutation detail declarations overlap: ${JSON.stringify(declared.marker)} and ${JSON.stringify(verdict.marker)}`)
      }
      mutationDetails.push({ marker: verdict.marker, detail })
    }
  }
  return mutationMarkers
}

for (const e of enrolled) {
  const at = `knownBreaches entry ${JSON.stringify(e?.court ?? '(unnamed)')}`
  if (typeof e?.court !== 'string' || e.court === '') die(`${at}: missing "court"`)
  if (seen.has(e.court)) die(`${at}: enrolled twice`)
  seen.add(e.court)
  if (typeof e.path !== 'string' || e.path === '') die(`${at}: missing "path"`)
  const courtPath = resolve(ROOT, e.path)
  if (courtPath !== ROOT && !courtPath.startsWith(ROOT + sep)) {
    die(`${at}: path ${JSON.stringify(e.path)} resolves outside the repository`)
  }
  let courtStat
  try {
    courtStat = lstatSync(courtPath)
  } catch (error) {
    die(`${at}: names ${e.path}, which could not be inspected: ${String(error?.code ?? error)}`)
  }
  if (!courtStat.isFile()) die(`${at}: names ${e.path}, which is not a regular file in this tree`)
  if (registeredElsewhere.has(e.court)) die(`${at}: also registered as an ordinary court; a court is graded in exactly one lane`)
  if (!Number.isInteger(e.expectedExit)) die(`${at}: missing integer "expectedExit"`)
  if (e.expectedExit === 0) die(`${at}: expectedExit 0 is not a breach; an enrollment that expects success is a lie`)
  if (e.expectedExit === SKIP_STATUS) die(`${at}: expectedExit ${SKIP_STATUS} is the platform-skip door, not a breach`)
  if (e.expectedExit === INCONCLUSIVE_STATUS) die(`${at}: expectedExit ${INCONCLUSIVE_STATUS} is an unverified measurement, not a breach`)
  if (typeof e.expectedSentinel !== 'string' || e.expectedSentinel === '') die(`${at}: missing "expectedSentinel"`)
  const expectedBreachRows = expectedRowIds(at, 'expectedBreachRows', e.expectedBreachRows, true)
  const expectedHeldRows = expectedRowIds(at, 'expectedHeldRows', e.expectedHeldRows, false)
  for (const id of expectedBreachRows) {
    if (expectedHeldRows.has(id)) die(`${at}: row ${id} appears in both expectedBreachRows and expectedHeldRows`)
  }
  if (!Number.isInteger(e.timeoutMs) || e.timeoutMs <= 0) die(`${at}: missing positive integer "timeoutMs"`)
  if (!Number.isInteger(e.expectedStderrBytes) || e.expectedStderrBytes < 0) die(`${at}: missing non-negative integer "expectedStderrBytes"`)
  if (typeof e.mutation !== 'object' || e.mutation === null || Array.isArray(e.mutation)) {
    die(`${at}: mutation must be an object`)
  }
  if (!Array.isArray(e.mutation.args) || e.mutation.args.length === 0
    || e.mutation.args.some((arg) => typeof arg !== 'string' || arg === '')) {
    die(`${at}: mutation.args must be a non-empty string array`)
  }
  if (e.mutation.expectedExit !== 0) die(`${at}: mutation.expectedExit must be 0`)
  if (typeof e.mutation.expectedSentinel !== 'string' || e.mutation.expectedSentinel === '') {
    die(`${at}: mutation.expectedSentinel must be a non-empty string`)
  }
  if (e.mutation.expectedSentinel !== 'MUTATION ordinary-row oracle') {
    die(`${at}: mutation.expectedSentinel must be exactly "MUTATION ordinary-row oracle"`)
  }
  const mutationMarkers = expectedMutationVerdicts(`${at}: mutation`, e.mutation.expectedVerdicts, MUTATION_VERDICTS)
  if (e.mutation.platformSkips !== undefined) {
    if (typeof e.mutation.platformSkips !== 'object' || e.mutation.platformSkips === null
      || Array.isArray(e.mutation.platformSkips) || Object.keys(e.mutation.platformSkips).length === 0) {
      die(`${at}: mutation.platformSkips must be a non-empty object when present`)
    }
    for (const [platform, outcome] of Object.entries(e.mutation.platformSkips)) {
      const outcomeAt = `${at}: mutation.platformSkips.${platform}`
      if (!PLATFORM_NAMES.has(platform)) die(`${outcomeAt}: platform is not supported`)
      if (typeof outcome !== 'object' || outcome === null || Array.isArray(outcome)) {
        die(`${outcomeAt}: outcome must be an object`)
      }
      const unknownKeys = Object.keys(outcome).filter((key) => !['expectedExit', 'expectedVerdicts'].includes(key))
      if (unknownKeys.length > 0) die(`${outcomeAt}: unknown keys: ${unknownKeys.sort().join(', ')}`)
      if (!Number.isInteger(outcome.expectedExit) || outcome.expectedExit === 0) {
        die(`${outcomeAt}: expectedExit must be a nonzero integer`)
      }
      const platformMarkers = expectedMutationVerdicts(outcomeAt, outcome.expectedVerdicts, PLATFORM_SKIP_VERDICTS)
      const missingMarkers = [...mutationMarkers].filter((marker) => !platformMarkers.has(marker))
      const extraMarkers = [...platformMarkers].filter((marker) => !mutationMarkers.has(marker))
      if (missingMarkers.length > 0 || extraMarkers.length > 0) {
        die(`${outcomeAt}: markers differ from the default mutation declaration`)
      }
      if (!outcome.expectedVerdicts.some(({ verdict }) => verdict === 'NOT DETECTED' || verdict === 'NOT HELD')) {
        die(`${outcomeAt}: a platform skip must declare at least one unavailable result`)
      }
    }
  }
  if (e.additionalRuns !== undefined) {
    if (!Array.isArray(e.additionalRuns) || e.additionalRuns.length === 0) {
      die(`${at}: additionalRuns must be a non-empty array when present`)
    }
    const additionalLabels = new Set()
    for (const run of e.additionalRuns) {
      if (typeof run?.label !== 'string' || run.label === '') die(`${at}: additional run needs a label`)
      if (additionalLabels.has(run.label)) die(`${at}: additional run ${JSON.stringify(run.label)} appears twice`)
      additionalLabels.add(run.label)
      if (!Array.isArray(run.args) || run.args.length === 0
        || run.args.some((arg) => typeof arg !== 'string' || arg === '')) {
        die(`${at}: additional run ${JSON.stringify(run.label)} needs non-empty string args`)
      }
      for (const platform of ['linux', 'other']) {
        const outcome = run.outcomes?.[platform]
        if (typeof outcome !== 'object' || outcome === null || Array.isArray(outcome)) {
          die(`${at}: additional run ${JSON.stringify(run.label)} needs ${platform} outcome`)
        }
        if (!Number.isInteger(outcome.expectedExit)) die(`${at}: ${run.label}.${platform} needs integer expectedExit`)
        if (typeof outcome.expectedSentinel !== 'string' || outcome.expectedSentinel === '') {
          die(`${at}: ${run.label}.${platform} needs expectedSentinel`)
        }
        if (!ADDITIONAL_CLASSIFICATIONS.has(outcome.classification)) {
          die(`${at}: ${run.label}.${platform} classification must be known-breach or skip`)
        }
        if (outcome.classification === 'skip' && outcome.expectedExit !== SKIP_STATUS) {
          die(`${at}: ${run.label}.${platform} skip must exit ${SKIP_STATUS}`)
        }
        if (outcome.classification === 'known-breach'
          && [0, SKIP_STATUS, INCONCLUSIVE_STATUS].includes(outcome.expectedExit)) {
          die(`${at}: ${run.label}.${platform} known breach needs a nonzero breach exit`)
        }
      }
    }
  }
  if (e.restorationRow !== null && (typeof e.restorationRow !== 'string' || !ROW_ID.test(e.restorationRow))) {
    die(`${at}: restorationRow must be null or one valid row id`)
  }
  if (e.restorationRow !== null && !expectedHeldRows.has(e.restorationRow)) {
    die(`${at}: restorationRow ${JSON.stringify(e.restorationRow)} is not among expectedHeldRows`)
  }

  // --- the runner-issued challenge, and the recorded absence of one ---------
  // A court with no challenge still runs; the manifest must SAY WHY it has
  // none, so the gap is a written sentence somebody can read rather than a
  // missing key nobody notices.
  const ch = e.runnerChallenge
  if (ch === undefined || ch === null) {
    if (typeof e.noChallengeBecause !== 'string' || e.noChallengeBecause.trim() === '') {
      die(`${at}: has no "runnerChallenge", so it MUST carry a non-empty "noChallengeBecause".`
        + ' An unchallenged court is graded entirely on its own output and is therefore forgeable by its'
        + ' own author; that gap is recorded in words, never left implied by a missing key.')
    }
  } else {
    if (typeof ch !== 'object' || Array.isArray(ch)) die(`${at}: "runnerChallenge" must be an object`)
    if (e.noChallengeBecause !== undefined) die(`${at}: carries both "runnerChallenge" and "noChallengeBecause"; exactly one is true`)
    if (typeof ch.plantIn !== 'string' || ch.plantIn === '') die(`${at}: runnerChallenge is missing "plantIn"`)
    const plantDir = resolve(ROOT, ch.plantIn)
    if (plantDir !== ROOT && !plantDir.startsWith(ROOT + sep)) die(`${at}: runnerChallenge.plantIn ${JSON.stringify(ch.plantIn)} resolves outside the repository`)
    if (ch.mustAppearInOutput !== true) die(`${at}: runnerChallenge.mustAppearInOutput must be literally true; a challenge whose answer is optional is not a challenge`)
    if (!PLANT_KINDS.has(ch.plantAs)) die(`${at}: runnerChallenge.plantAs must be one of ${[...PLANT_KINDS].join(', ')}`)
    if (typeof ch.why !== 'string' || ch.why === '') die(`${at}: runnerChallenge needs "why", naming the enumeration the plant lands inside`)
  }
  if (e.runnerPreparation !== undefined) {
    if (!RUNNER_PREPARATIONS.has(e.runnerPreparation)) {
      die(`${at}: runnerPreparation must be one of ${[...RUNNER_PREPARATIONS].join(', ')}`)
    }
    if (e.runnerPreparation === 'profile-module-fallback'
      && (ch === undefined || ch === null || ch.plantIn !== 'profiles/node_modules' || ch.plantAs !== 'dangling-symlink')) {
      die(`${at}: profile-module-fallback preparation requires the flat-fallback dangling-symlink challenge`)
    }
  }
}
const scheduledRunRoster = [
  ...courts_dual.flatMap((court) => ordinaryModes(court).map(mode => runIdentity(
    `ordinary:${court}:${mode.label}`,
    `courts/harness/${court}/run.mjs`,
    mode.args,
  ))),
  ...wysiwysModes.map(mode => runIdentity(
    `ordinary:wysiwys-issuer:${mode.label}`,
    'courts/harness/wysiwys-issuer/run.mjs',
    mode.args,
  )),
  ...enrolled.flatMap((entry) => [
    runIdentity(`enrolled:${entry.court}:normal`, entry.path, []),
    runIdentity(`enrolled:${entry.court}:mutation`, entry.path, entry.mutation.args),
    ...(entry.additionalRuns ?? []).map(run => runIdentity(
      `enrolled:${entry.court}:additional:${run.label}`,
      entry.path,
      run.args,
    )),
  ]),
]
const rosterFaults = gateRosterFaults(scheduledRunRoster)
if (rosterFaults.length > 0) die(`scheduled run roster differs from the fixed production roster: ${rosterFaults.join('; ')}`)
const RESTORE_MARKERS = manifest.restorationFailureMarkers ?? []
const CRASH_MARKERS = manifest.crashMarkers ?? []
if (!Array.isArray(RESTORE_MARKERS) || RESTORE_MARKERS.length === 0) die('"restorationFailureMarkers" must name at least one marker')
if (!Array.isArray(CRASH_MARKERS)) die('"crashMarkers" must be an array')

const sorted = (set) => [...set].sort()
const diff = (expected, observed) => ({
  missing: expected.filter((r) => !observed.has(r)),
  extra: sorted(observed).filter((r) => !expected.includes(r)),
})

/**
 * The gate's own restoration evidence, taken around every enrolled court.
 * It covers tracked files, non-ignored untracked files, and the ignored active
 * runtime surfaces `.aukora/`, `profiles/`, and package `lib/` trees. For each
 * listed entry it binds the path, POSIX mode, uid, gid, symlink target, and
 * regular-file bytes. It does not cover other ignored entries, `.git`, directory
 * metadata or empty directories, ACLs, extended attributes, BSD flags, hard-link
 * identity, or bytes reached through a symlink. A court that self-reports
 * restoration is reporting on itself; this runner-owned scoped witness is the
 * working tree's answer. Failing to take it is a failure to certify.
 */
const gitWitness = () => {
  const status = spawnSync(GIT_PATH, gitArgs('-C', ROOT, 'status', '--porcelain', '--untracked-files=all'), {
    encoding: 'utf8',
    env: GATE_ENV,
    maxBuffer: GIT_WITNESS_MAX_BUFFER,
  })
  if (status.error !== undefined || status.status !== 0) {
    return { ok: false, detail: String(status.error?.message ?? status.stderr ?? `git status exit ${status.status}`) }
  }
  const listed = spawnSync(GIT_PATH, gitArgs('-C', ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'), {
    encoding: 'buffer',
    env: GATE_ENV,
    maxBuffer: GIT_WITNESS_MAX_BUFFER,
  })
  if (listed.error !== undefined || listed.status !== 0) {
    return { ok: false, detail: String(listed.error?.message ?? listed.stderr?.toString('utf8') ?? `git ls-files exit ${listed.status}`) }
  }
  const ignored = spawnSync(GIT_PATH, gitArgs(
    '-C', ROOT, 'ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--',
    '.aukora/',
    'profiles/',
    ':(glob)apps/**/lib/**',
    ':(glob)vendor/**/lib/**',
    ':(glob)packages/**/lib/**',
  ), { encoding: 'buffer', env: GATE_ENV, maxBuffer: GIT_WITNESS_MAX_BUFFER })
  if (ignored.error !== undefined || ignored.status !== 0) {
    return { ok: false, detail: String(ignored.error?.message ?? ignored.stderr?.toString('utf8') ?? `git ignored-files exit ${ignored.status}`) }
  }
  const activeIgnored = ignored.stdout.toString('utf8').split('\0').filter((path) =>
    path.startsWith('profiles/')
    || path.startsWith('.aukora/')
    || /^(?:apps|vendor|packages)\/.*\/lib\//.test(path))
  const paths = [...new Set([
    ...listed.stdout.toString('utf8').split('\0').filter(Boolean),
    ...activeIgnored,
  ])].sort()
  const digest = createHash('sha256')
  const addTo = (target, value) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8')
    const length = Buffer.alloc(8)
    length.writeBigUInt64BE(BigInt(bytes.length))
    target.update(length).update(bytes)
  }
  const members = new Map()
  try {
    for (const relative of paths) {
      const member = createHash('sha256')
      const add = (value) => {
        addTo(digest, value)
        addTo(member, value)
      }
      const absolute = join(ROOT, relative)
      add(relative)
      let stat
      try {
        stat = lstatSync(absolute)
      } catch (error) {
        if (error?.code === 'ENOENT') {
          add('missing')
          members.set(relative, member.digest('hex'))
          continue
        }
        throw error
      }
      add(stat.mode)
      add(stat.uid)
      add(stat.gid)
      if (stat.isSymbolicLink()) {
        add('symlink')
        add(readlinkSync(absolute))
      } else if (stat.isFile()) {
        add('file')
        add(readFileSync(absolute))
      } else {
        add(`other:${stat.mode}`)
      }
      members.set(relative, member.digest('hex'))
    }
  } catch (error) {
    return { ok: false, detail: `could not hash working-tree bytes: ${String(error?.code ?? error?.message ?? error)}` }
  }
  return { ok: true, text: status.stdout, digest: digest.digest('hex'), members }
}

/** Read the exact checked-out commit and its committed tree through the fixed Git executable. */
const gitSubjectWitness = () => {
  const result = spawnSync(GIT_PATH, gitArgs('-C', ROOT, 'rev-parse', 'HEAD', 'HEAD^{tree}'), {
    encoding: 'utf8',
    env: GATE_ENV,
    maxBuffer: GIT_WITNESS_MAX_BUFFER,
  })
  if (result.error !== undefined || result.status !== 0 || result.signal !== null) {
    return {
      ok: false,
      detail: String(result.error?.message ?? result.stderr ?? result.signal ?? `git rev-parse exit ${result.status}`),
    }
  }
  const lines = result.stdout.trim().split('\n')
  if (lines.length !== 2 || lines.some(line => !/^[0-9a-f]+$/.test(line))) {
    return { ok: false, detail: 'git rev-parse did not return one commit and one tree object id' }
  }
  return { ok: true, commit: lines[0], tree: lines[1] }
}

/** Read pnpm's version without retaining its environment or diagnostic output. */
const pnpmVersionWitness = () => {
  const result = spawnSync(PNPM_PATH, ['--version'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: GATE_ENV,
    timeout: PREPARATION_TIMEOUT_MS,
  })
  if (result.error !== undefined || result.status !== 0 || result.signal !== null) {
    return {
      ok: false,
      detail: String(result.error?.message ?? result.signal ?? `pnpm --version exit ${result.status}`),
    }
  }
  const version = result.stdout.trim()
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    return { ok: false, detail: 'pnpm --version did not return one semantic version' }
  }
  return { ok: true, version }
}

/** Project checkout state without retaining pathnames or file bytes in the report. */
const reportCheckoutWitness = (witness) => ({
  clean: witness.ok && witness.text === '',
  statusSha256: witness.ok
    ? createHash('sha256').update(witness.text, 'utf8').digest('hex')
    : null,
  activeTreeSha256: witness.ok ? witness.digest : null,
})

/** Name changed witness members without printing their potentially sensitive bytes. */
const changedWitnessPaths = (before, after) => {
  const paths = new Set([...before.members.keys(), ...after.members.keys()])
  return [...paths].filter((path) => before.members.get(path) !== after.members.get(path)).sort()
}

/** Compare one stable observation with the post-build gate baseline. */
const baselineFaults = (baseline, observed, label) => {
  if (!observed.ok) return [`${label} could not be witnessed: ${observed.detail}`]
  if (observed.text === baseline.text && observed.digest === baseline.digest) return []
  const changed = changedWitnessPaths(baseline, observed)
  return [`${label} differs from the gate baseline: ${changed.join(', ') || 'Git porcelain changed'}`]
}

/** Reject index flags that can hide tracked-byte changes from Git porcelain. */
const indexFlagFaults = () => {
  const result = spawnSync(GIT_PATH, gitArgs('-C', ROOT, 'ls-files', '-v', '-z'), {
    encoding: 'buffer',
    env: GATE_ENV,
    maxBuffer: GIT_WITNESS_MAX_BUFFER,
  })
  if (result.error !== undefined || result.status !== 0) {
    return [`could not inspect tracked-file index flags: ${String(result.error?.message ?? result.stderr?.toString('utf8') ?? `exit ${result.status}`)}`]
  }
  const hidden = result.stdout.toString('utf8').split('\0').filter(entry => entry !== '' && !entry.startsWith('H '))
  return hidden.length === 0 ? [] : [`tracked files carry non-default index flags: ${hidden.join(', ')}`]
}

/** Inspect an entry without converting an observation failure into absence. */
const entryPresence = (path) => {
  try {
    lstatSync(path)
    return { present: true }
  } catch (error) {
    if (error?.code === 'ENOENT') return { present: false }
    return { present: null, error }
  }
}

/** Require the two launch-owned subjects to be absent before runner setup. */
const requireFreshProfileClosure = () => {
  for (const path of [RUNTIME_CONFIG, RUNTIME_FALLBACK]) {
    const presence = entryPresence(path)
    if (presence.present === null) {
      throw new Error(`could not inspect runner preparation subject ${path}: ${String(presence.error?.code ?? presence.error)}`)
    }
    if (presence.present) {
      throw new Error(`runner preparation requires a fresh checkout; ${path} already exists`)
    }
  }
}

/** Count links without following them so a dangling challenge is still a subject. */
const countLinks = (dir) => {
  let count = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) count++
    else if (entry.isDirectory()) count += countLinks(join(dir, entry.name))
  }
  return count
}

/** Bind one filesystem entry without following a symlink. */
const entryFingerprint = (path) => {
  const stat = lstatSync(path)
  const parts = [
    stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'file' : 'other',
    stat.dev,
    stat.ino,
    stat.mode,
    stat.uid,
    stat.gid,
    stat.nlink,
    stat.size,
  ]
  if (stat.isSymbolicLink()) parts.push(readlinkSync(path))
  else if (stat.isFile()) parts.push(createHash('sha256').update(readFileSync(path)).digest('hex'))
  return parts.join('\u0000')
}

/** Bind the fallback root and its members, including ignored empty directories. */
const directoryTopology = (dir) => {
  const members = []
  const walk = (path, relative) => {
    members.push(`${relative}\u0000${entryFingerprint(path)}`)
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const next = join(path, entry.name)
      const label = relative === '' ? entry.name : join(relative, entry.name)
      if (entry.isDirectory()) walk(next, label)
      else members.push(`${label}\u0000${entryFingerprint(next)}`)
    }
  }
  walk(dir, '')
  return members.sort().join('\n')
}

/**
 * Bind the external runtime roots used by scheduled courts. Package-directory
 * symlinks are followed recursively so pnpm's transitive package graph is part
 * of the observation rather than only its top-level link names.
 */
const runnerToolchainWitness = () => {
  const digest = createHash('sha256')
  const visitedDirectories = new Set()
  const add = (value) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8')
    const length = Buffer.alloc(8)
    length.writeBigUInt64BE(BigInt(bytes.length))
    digest.update(length).update(bytes)
  }
  const walkEntry = (path) => {
    const stat = lstatSync(path)
    add(path)
    add(stat.mode)
    add(stat.uid)
    add(stat.gid)
    add(stat.size)
    if (stat.isSymbolicLink()) {
      add(readlinkSync(path))
      const target = realpathSync(path)
      const targetStat = lstatSync(target)
      if (targetStat.isDirectory()) walkDirectory(target)
      else if (targetStat.isFile()) {
        add(target)
        add(readFileSync(target))
      }
    } else if (stat.isDirectory()) {
      walkDirectory(path)
    } else if (stat.isFile()) {
      add(readFileSync(path))
    }
  }
  const walkExecutable = (path) => {
    try {
      walkEntry(path)
    } catch (error) {
      if (error?.code !== 'EACCES') throw error
      const real = realpathSync(path)
      const stat = lstatSync(real)
      if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o022) !== 0 || (stat.mode & 0o111) === 0) throw error
      // macOS sudo is root-owned and execute-only. The caller cannot read its
      // bytes, so bind the kernel identity and metadata it can observe instead.
      add('<root-owned-execute-only>')
      for (const value of [real, stat.dev, stat.ino, stat.mode, stat.uid, stat.gid, stat.nlink, stat.size, stat.mtimeMs, stat.ctimeMs]) add(value)
    }
  }
  const walkDirectory = (path) => {
    const real = realpathSync(path)
    if (visitedDirectories.has(real)) return
    visitedDirectories.add(real)
    add(real)
    for (const entry of readdirSync(real, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      walkEntry(join(real, entry.name))
    }
  }
  try {
    const packageRoots = ['js-yaml', 'tsx', 'vitest'].map(name =>
      dirname(fileURLToPath(import.meta.resolve(`${name}/package.json`))))
    const pnpmRoot = resolve(dirname(realpathSync(PNPM_PATH)), '..')
    add(GATE_ENV.PATH ?? '')
    for (const root of [...packageRoots, pnpmRoot]) walkDirectory(root)
    for (const entry of resolvePathExecutables(PATH_ENTRIES, COURT_PATH_EXECUTABLES)) {
      add(entry.name)
      add(entry.path ?? '<absent>')
      if (entry.path !== null) walkExecutable(entry.path)
    }
    for (const file of COURT_ABSOLUTE_EXECUTABLES) {
      add(file)
      if (existsSync(file)) walkExecutable(file)
      else add('<absent>')
    }
    for (const file of [process.execPath, PATH_NODE, GIT_PATH, PNPM_PATH, join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'vitest.cmd' : 'vitest')]) {
      walkExecutable(file)
    }
    return { ok: true, digest: digest.digest('hex'), members: visitedDirectories.size }
  } catch (error) {
    return { ok: false, detail: String(error?.code ?? error?.message ?? error) }
  }
}

/** Compare the external runtime closure with its post-build observation. */
const toolchainFaults = (baseline, observed, label) => {
  if (!observed.ok) return [`${label} could not be witnessed: ${observed.detail}`]
  return observed.digest === baseline.digest
    ? []
    : [`${label} differs from the post-build runtime closure`]
}

/**
 * Delete only the two paths a fresh runner preparation created. Type checks
 * detect a changed path before cleanup. A same-UID path replacement after the
 * final observation remains outside what pathname operations can establish.
 */
const removeFreshProfileClosure = () => {
  const failures = []
  for (const [label, path, expected] of [
    ['root config', RUNTIME_CONFIG, 'file'],
    ['module fallback', RUNTIME_FALLBACK, 'directory'],
  ]) {
    const presence = entryPresence(path)
    if (presence.present === null) {
      failures.push(`${label} could not be inspected: ${String(presence.error?.code ?? presence.error)}`)
      continue
    }
    if (!presence.present) continue
    try {
      const stat = lstatSync(path)
      if (expected === 'file' ? !stat.isFile() : !stat.isDirectory()) {
        throw new Error(`changed type at ${path}`)
      }
      if (expected === 'file') unlinkSync(path)
      else rmSync(path, { recursive: true, force: false })
    } catch (error) {
      failures.push(`${label} ${String(error?.code ?? error?.message ?? error)}`)
    }
  }
  return failures
}

/** Roll back a preparation that failed before it could return an ownership token. */
const rollbackFailedPreparation = (baseline) => {
  const failures = removeFreshProfileClosure()
  const restored = gitWitness()
  if (!restored.ok) failures.push(`could not witness rollback: ${restored.detail}`)
  else if (restored.text !== baseline.text || restored.digest !== baseline.digest) {
    const changed = changedWitnessPaths(baseline, restored)
    failures.push(`rollback did not restore baseline: ${changed.join(', ') || 'Git porcelain changed'}`)
  }
  return failures
}

/**
 * Materialize the one profile closure that the flat-fallback challenge needs.
 * The enum is validated at manifest load; its implementation is deliberately
 * closed here rather than accepting an enrollment-provided command string.
 */
const prepareRunnerSubstrate = (e) => {
  if (e.runnerPreparation === undefined) return null
  if (e.runnerPreparation !== 'profile-module-fallback') {
    throw new Error(`unimplemented runner preparation: ${e.runnerPreparation}`)
  }

  const baseline = gitWitness()
  if (!baseline.ok) throw new Error(`could not witness pre-preparation tree: ${baseline.detail}`)
  requireFreshProfileClosure()
  try {
    const result = spawnSync(process.execPath, [RUNTIME_CLI, '--profile', RUNTIME_PROFILE, '--dump-config'], {
      cwd: ROOT,
      env: { ...GATE_ENV, DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1' },
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: PREPARATION_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    })
    if (result.error !== undefined || result.status !== 0 || result.signal !== null) {
      throw new Error(String(result.error?.message ?? result.stderr ?? result.signal ?? `exit ${result.status}`))
    }
    const config = entryPresence(RUNTIME_CONFIG)
    const fallback = entryPresence(RUNTIME_FALLBACK)
    if (config.present !== true || !lstatSync(RUNTIME_CONFIG).isFile()) {
      throw new Error(`shipped launcher did not create the profile root config: ${RUNTIME_CONFIG}`)
    }
    if (fallback.present !== true || !lstatSync(RUNTIME_FALLBACK).isDirectory()) {
      throw new Error(`shipped launcher did not create the module fallback: ${RUNTIME_FALLBACK}`)
    }
    const links = countLinks(RUNTIME_FALLBACK)
    if (links === 0) throw new Error(`shipped launcher created an empty module fallback: ${RUNTIME_FALLBACK}`)
    const witness = gitWitness()
    if (!witness.ok) throw new Error(`could not witness prepared tree: ${witness.detail}`)
    return { baseline, witness, topology: directoryTopology(RUNTIME_FALLBACK) }
  } catch (error) {
    const failures = rollbackFailedPreparation(baseline)
    const cleanup = failures.length === 0 ? 'runner-owned paths rolled back' : `rollback failed: ${failures.join('; ')}`
    throw new Error(`${String(error?.message ?? error)}; ${cleanup}`)
  }
}

/**
 * Restore a named runner preparation only when the post-challenge tree still
 * equals the runner's prepared witness. Detected drift leaves evidence in
 * place and fails the lane instead of recursively deleting an unrecognized path.
 */
const restoreRunnerSubstrate = (prepared) => {
  if (prepared === null) return []
  const current = gitWitness()
  if (!current.ok) return [`could not witness prepared tree before cleanup: ${current.detail}`]
  if (current.text !== prepared.witness.text || current.digest !== prepared.witness.digest) {
    const changed = changedWitnessPaths(prepared.witness, current)
    return [`prepared tree changed before cleanup: ${changed.join(', ') || 'Git porcelain changed without a selected member digest change'}`]
  }
  try {
    if (directoryTopology(RUNTIME_FALLBACK) !== prepared.topology) {
      return ['prepared fallback directory metadata changed before cleanup']
    }
  } catch (error) {
    return [`could not inspect prepared fallback before cleanup: ${String(error?.code ?? error?.message ?? error)}`]
  }
  const cleanup = removeFreshProfileClosure()
  if (cleanup.length > 0) return cleanup
  for (const path of [RUNTIME_CONFIG, RUNTIME_FALLBACK]) {
    const presence = entryPresence(path)
    if (presence.present === null) return [`could not verify cleanup at ${path}: ${String(presence.error?.code ?? presence.error)}`]
    if (presence.present) return [`runner-owned preparation left ${path} behind`]
  }
  const restored = gitWitness()
  if (!restored.ok) return [`could not witness restored tree: ${restored.detail}`]
  if (restored.text !== prepared.baseline.text || restored.digest !== prepared.baseline.digest) {
    const changed = changedWitnessPaths(prepared.baseline, restored)
    return [`runner preparation did not restore its baseline: ${changed.join(', ') || 'Git porcelain changed without a selected member digest change'}`]
  }
  return []
}

/** Reject caller-owned generated state before any court begins its measurement. */
const requireFreshRunnerSubstrates = () => {
  for (const e of enrolled) {
    if (e.runnerPreparation === 'profile-module-fallback') requireFreshProfileClosure()
  }
}

/**
 * Plant this enrollment's challenge, if it has one.
 * @param e - the enrollment.
 * @returns `{ name, path }` with both null when unchallenged, `{ unavailable }`
 * when the measured directory is absent, or `{ failure }` for every other
 * planting failure.
 */
const plantChallenge = (e) => {
  const ch = e.runnerChallenge
  if (ch === undefined || ch === null) return { name: null, path: null, created: false }
  const name = `${CHALLENGE_PREFIX}${randomBytes(8).toString('hex')}`
  const plantDir = resolve(ROOT, ch.plantIn)
  let plantDirStat
  try {
    plantDirStat = lstatSync(plantDir)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        name: null,
        path: null,
        created: false,
        plantAs: ch.plantAs,
        unavailable: `the challenge subject directory ${plantDir} does not exist`,
      }
    }
    return {
      name: null,
      path: null,
      created: false,
      plantAs: ch.plantAs,
      failure: `the challenge subject ${plantDir} could not be inspected: ${String(error?.code ?? error)}`,
    }
  }
  if (!plantDirStat.isDirectory()) {
    return {
      name: null, path: null, created: false, plantAs: ch.plantAs,
      failure: `the challenge subject ${plantDir} is not a directory`,
    }
  }
  const path = join(plantDir, name)
  let created = false
  let descriptor = null
  let fingerprint
  try {
    if (ch.plantAs === 'dangling-symlink') {
      symlinkSync(DANGLING_TARGET, path)
      created = true
    } else {
      descriptor = openSync(path, 'wx')
      created = true
      closeSync(descriptor)
      descriptor = null
    }
    fingerprint = entryFingerprint(path)
  } catch (error) {
    return {
      name,
      path,
      created,
      descriptor,
      plantAs: ch.plantAs,
      failure: `the runner challenge could not be planted at ${path}: ${String(error?.code ?? error?.message ?? error)}`,
    }
  }
  return {
    name,
    path,
    created,
    descriptor: null,
    plantAs: ch.plantAs,
    fingerprint,
  }
}

/**
 * Remove a planted challenge. The gate's own evidence must never survive the run.
 * @param planted - the result of `plantChallenge`.
 * @returns a fault sentence when the plant is still on disk, otherwise undefined.
 */
const unplantChallenge = (planted) => {
  if (planted.path === null || planted.created !== true) return undefined
  const presence = entryPresence(planted.path)
  if (presence.present === null) {
    return `THE GATE COULD NOT INSPECT ITS CHALLENGE PLANT (${planted.path}: ${String(presence.error?.code ?? presence.error)});`
      + ' the lane fails closed rather than treat an observation failure as removal'
  }
  if (!presence.present) {
    return `THE GATE'S OWN CHALLENGE PLANT DISAPPEARED BEFORE REMOVAL (${planted.path}); the lane fails closed`
  }
  try {
    if (planted.fingerprint === undefined || entryFingerprint(planted.path) !== planted.fingerprint) {
      return `THE GATE'S OWN CHALLENGE PLANT CHANGED BEFORE REMOVAL (${planted.path}); the lane fails closed`
    }
    unlinkSync(planted.path)
  } catch (error) {
    return `THE GATE'S OWN CHALLENGE PLANT COULD NOT BE REMOVED (${planted.path}: ${String(error?.code ?? error)});`
      + ' the lane fails closed rather than leave its evidence in the tree'
  }
  const removed = entryPresence(planted.path)
  if (removed.present === null) {
    return `THE GATE COULD NOT VERIFY CHALLENGE REMOVAL (${planted.path}: ${String(removed.error?.code ?? removed.error)});`
      + ' an observation failure is not absence'
  }
  if (removed.present) {
    return `THE GATE'S OWN CHALLENGE PLANT IS STILL ON DISK after unlink (${planted.path}); the lane fails closed`
  }
  return undefined
}

// ---------------------------------------------------------------------------
// The ordinary lanes.
// ---------------------------------------------------------------------------
try {
  requireFreshRunnerSubstrates()
} catch (error) {
  console.error(`\n  *** GATE PRECONDITION FAILED *** ${String(error?.message ?? error)}`)
  process.exit(1)
}
const initialWitness = gitWitness()
if (!initialWitness.ok) {
  console.error(`\n  *** GATE PRECONDITION FAILED *** could not witness the initial checkout: ${initialWitness.detail}`)
  process.exit(1)
}
if (initialWitness.text !== '') {
  console.error('\n  *** GATE PRECONDITION FAILED *** the Court Gate requires a clean tracked and untracked checkout')
  process.stderr.write(initialWitness.text)
  process.exit(1)
}
const initialSubject = REPORT_ENABLED ? gitSubjectWitness() : null
if (initialSubject !== null && !initialSubject.ok) {
  console.error(`\n  *** GATE PRECONDITION FAILED *** could not identify the checked-out subject: ${initialSubject.detail}`)
  process.exit(1)
}
const hiddenIndexFaults = indexFlagFaults()
if (hiddenIndexFaults.length > 0) {
  console.error(`\n  *** GATE PRECONDITION FAILED *** ${hiddenIndexFaults.join('; ')}`)
  process.exit(1)
}
buildArtifactPlane()
const gateBaseline = gitWitness()
if (!gateBaseline.ok) {
  console.error(`\n  *** GATE PRECONDITION FAILED *** could not witness the post-build checkout: ${gateBaseline.detail}`)
  process.exit(1)
}
if (gateBaseline.text !== '') {
  console.error('\n  *** GATE PRECONDITION FAILED *** build:lib changed tracked or non-ignored state')
  process.stderr.write(gateBaseline.text)
  process.exit(1)
}
const unexpectedBuildPaths = changedWitnessPaths(initialWitness, gateBaseline).filter(path =>
  !/^(?:apps|packages|vendor)\/.*\/lib(?:\/|$)/.test(path))
if (unexpectedBuildPaths.length > 0) {
  console.error(`\n  *** GATE PRECONDITION FAILED *** build:lib changed undeclared paths: ${unexpectedBuildPaths.join(', ')}`)
  process.exit(1)
}
runParentLaunchAssembly()
const assemblyWitness = gitWitness()
const assemblyWitnessFaults = baselineFaults(gateBaseline, assemblyWitness, 'parent launch post-run tree')
if (assemblyWitnessFaults.length > 0) {
  console.error(`\n  *** GATE PRECONDITION FAILED *** ${assemblyWitnessFaults.join('; ')}`)
  process.exit(1)
}
const toolchainBaseline = runnerToolchainWitness()
if (!toolchainBaseline.ok) {
  console.error(`\n  *** GATE PRECONDITION FAILED *** could not witness the runner toolchain: ${toolchainBaseline.detail}`)
  process.exit(1)
}
const pnpmVersion = REPORT_ENABLED ? pnpmVersionWitness() : null
if (pnpmVersion !== null && !pnpmVersion.ok) {
  console.error(`\n  *** GATE PRECONDITION FAILED *** could not identify pnpm: ${pnpmVersion.detail}`)
  process.exit(1)
}
const runOrdinary = (court, label, path, args) => {
  const armStarted = performance.now()
  const identity = runIdentity(`ordinary:${court}:${label}`, path, args)
  observedRunRoster.push(identity)
  const before = gitWitness()
  const preRunFaults = [
    ...baselineFaults(gateBaseline, before, 'ordinary pre-run tree'),
    ...toolchainFaults(toolchainBaseline, runnerToolchainWitness(), 'ordinary pre-run toolchain'),
    ...indexFlagFaults().map(fault => `ordinary pre-run index: ${fault}`),
  ]
  if (preRunFaults.length > 0) {
    recordClassification(identity, 'unexpected', undefined, 0, armStarted, preRunFaults)
    red++
    unexpected.push(`${court} ${label} (${preRunFaults.join('; ')})`)
    console.log(`FAIL  ${court} ${label} (${preRunFaults.join('; ')})`)
    return
  }
  const processStarted = performance.now()
  const result = spawnSync(process.execPath, [resolve(ROOT, path), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: GATE_ENV,
    maxBuffer: 64 * 1024 * 1024,
    timeout: ordinaryTimeoutMs(court),
    killSignal: 'SIGKILL',
  })
  const processDurationMs = performance.now() - processStarted
  const after = gitWitness()
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')
  const witnessFaults = baselineFaults(gateBaseline, after, 'ordinary post-run tree')
  witnessFaults.push(...indexFlagFaults().map(fault => `ordinary post-run index: ${fault}`))
  if (!before.ok || !after.ok) {
    witnessFaults.push(`restoration could not be witnessed (${before.ok ? after.detail : before.detail})`)
  } else if (before.text !== after.text || before.digest !== after.digest) {
    const changed = changedWitnessPaths(before, after)
    witnessFaults.push(`the working tree changed while this court ran: ${changed.join(', ') || 'Git porcelain changed'}`)
  }
  const displayLabel = court === 'wysiwys-issuer'
    ? `${court} ${label}`
    : label === 'normal' ? court
      : label === 'mutation' ? `${court} --mutate`
        : `${court} --arm=${label}`
  tally(
    court,
    displayLabel,
    identity,
    result,
    processDurationMs,
    armStarted,
    witnessFaults,
    label !== 'normal',
  )
}
for (const c of courts_dual) {
  for (const mode of ordinaryModes(c)) {
    runOrdinary(
      c,
      mode.label,
      `courts/harness/${c}/run.mjs`,
      mode.args,
    )
  }
}
for (const mode of wysiwysModes) {
  runOrdinary(
    'wysiwys-issuer',
    mode.label,
    'courts/harness/wysiwys-issuer/run.mjs',
    mode.args,
  )
}
// ---------------------------------------------------------------------------
// The enrolled lane executes each court once against the ordinary subject and
// once against its declared counterfactual. Additional proof modes are separate
// subprocesses. Every subprocess gets fresh preparation, challenge planting,
// restoration witnesses, and one primary headline classification.
//
// A CRASH IS NOT A KNOWN BREACH. A court that threw, timed out, died on a
// signal, or collected no rows is an UNEXPECTED GATE FAILURE and turns the gate
// red. A known-breach lane that swallows a crashed court is a green light wired
// to nothing, which is the exact defect this project exists to prevent.
// ---------------------------------------------------------------------------
const resolvedCourts = []
if (enrolled.length > 0) {
  console.log(`\n${'='.repeat(78)}\n  KNOWN-BREACH LANE — ${enrolled.length} enrolled in courts/known-breaches.json\n${'='.repeat(78)}`)
}
/** Run and classify one independently prepared enrolled mode. */
const runEnrolledMode = (e, mode) => {
  const armStarted = performance.now()
  const label = `${mode.kind} ${e.court}${mode.label === undefined ? '' : ` ${mode.label}`}`
  const identityLabel = mode.kind === 'additional'
    ? `enrolled:${e.court}:additional:${mode.label}`
    : `enrolled:${e.court}:${mode.kind}`
  const identity = runIdentity(identityLabel, e.path, mode.args)
  observedRunRoster.push(identity)
  const stableBeforePreparation = gitWitness()
  const stableFaults = [
    ...baselineFaults(gateBaseline, stableBeforePreparation, 'enrolled pre-run tree'),
    ...toolchainFaults(toolchainBaseline, runnerToolchainWitness(), 'enrolled pre-run toolchain'),
    ...indexFlagFaults().map(fault => `enrolled pre-run index: ${fault}`),
  ]
  if (stableFaults.length > 0) {
    recordClassification(identity, 'unexpected', undefined, 0, armStarted, stableFaults)
    red++
    unexpected.push(label)
    console.log(`\nFAIL  UNEXPECTED GATE FAILURE — ${label}: ${stableFaults.join('; ')}`)
    return
  }
  let prepared
  try {
    prepared = prepareRunnerSubstrate(e)
  } catch (error) {
    const fault = `runner preparation failed: ${String(error?.message ?? error)}`
    recordClassification(identity, 'unexpected', undefined, 0, armStarted, [fault])
    red++
    unexpected.push(label)
    console.log(`\nFAIL  UNEXPECTED GATE FAILURE — ${label}: runner preparation failed`)
    console.log(`        ${String(error?.message ?? error)}`)
    return
  }
  let planted
  try {
    planted = plantChallenge(e)
  } catch (error) {
    const preparationFailure = restoreRunnerSubstrate(prepared)
    const faults = [
      `runner challenge creation threw: ${String(error?.message ?? error)}`,
      ...preparationFailure.map(failure => `runner preparation restoration failed: ${failure}`),
    ]
    recordClassification(identity, 'unexpected', undefined, 0, armStarted, faults)
    red++
    unexpected.push(label)
    console.log(`\nFAIL  UNEXPECTED GATE FAILURE — ${label}: runner challenge creation threw`)
    console.log(`        ${String(error?.message ?? error)}`)
    for (const failure of preparationFailure) console.log(`        runner preparation restoration failed: ${failure}`)
    return
  }
  if (planted.failure !== undefined) {
    const removalFailure = unplantChallenge(planted)
    const preparationFailure = restoreRunnerSubstrate(prepared)
    const faults = [
      planted.failure,
      ...(removalFailure === undefined ? [] : [removalFailure]),
      ...preparationFailure.map(failure => `runner preparation restoration failed: ${failure}`),
    ]
    recordClassification(identity, 'unexpected', undefined, 0, armStarted, faults)
    red++
    unexpected.push(label)
    console.log(`\nFAIL  UNEXPECTED GATE FAILURE — ${label}: ${planted.failure}`)
    if (removalFailure !== undefined) console.log(`        ${removalFailure}`)
    for (const failure of preparationFailure) console.log(`        runner preparation restoration failed: ${failure}`)
    return
  }
  let before
  let after
  let result
  let elapsedMs
  let removalFailure
  let preparationFailure
  let stableAfterCleanup
  try {
    before = gitWitness()
    const processStarted = performance.now()
    result = spawnSync(process.execPath, [resolve(ROOT, e.path), ...mode.args], {
      cwd: ROOT,
      encoding: 'utf8',
      env: GATE_ENV,
      timeout: e.timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: 64 * 1024 * 1024,
    })
    elapsedMs = Math.round(performance.now() - processStarted)
    after = gitWitness()
  } finally {
    removalFailure = unplantChallenge(planted)
    preparationFailure = restoreRunnerSubstrate(prepared)
    stableAfterCleanup = gitWitness()
  }

  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const rows = parseCourtRows(text)
  const faults = []
  if (result.error?.code === 'ETIMEDOUT') faults.push(`TIMED OUT after ${e.timeoutMs} ms`)
  else if (result.error !== undefined) faults.push(`the court could not be executed: ${String(result.error.message)}`)
  if (result.signal !== null && result.signal !== undefined) {
    faults.push(`killed by signal ${result.signal}`)
  }
  for (const marker of CRASH_MARKERS) if (text.includes(marker)) faults.push(`the court reported a crash: ${JSON.stringify(marker)}`)
  const stderrBytes = Buffer.byteLength(result.stderr ?? '', 'utf8')
  if (stderrBytes !== e.expectedStderrBytes) {
    faults.push(`wrote ${stderrBytes} bytes to stderr, enrolled ${e.expectedStderrBytes}`)
  }
  for (const marker of RESTORE_MARKERS) if (text.includes(marker)) faults.push(`the court reported a restore failure: ${JSON.stringify(marker)}`)
  if (removalFailure !== undefined) faults.push(removalFailure)
  for (const failure of preparationFailure) faults.push(`runner preparation restoration failed: ${failure}`)
  faults.push(...baselineFaults(gateBaseline, stableAfterCleanup, 'enrolled post-cleanup tree'))
  faults.push(...indexFlagFaults().map(fault => `enrolled post-cleanup index: ${fault}`))
  if (!before.ok || !after.ok) {
    faults.push(`restoration could not be witnessed (${before.ok ? after.detail : before.detail})`)
  } else if (before.text !== after.text || before.digest !== after.digest) {
    const changed = changedWitnessPaths(before, after)
    faults.push(`the working tree changed while this court ran: ${changed.join(', ') || 'Git porcelain changed'}`)
  }

  const inconclusive = mode.kind === 'normal' && result.status === INCONCLUSIVE_STATUS
  if (planted.unavailable !== undefined && !inconclusive) {
    faults.push(`runner challenge unavailable: ${planted.unavailable}`)
  }
  if (planted.name !== null && !(result.stdout ?? '').includes(planted.name)) {
    faults.push(`runner challenge ${JSON.stringify(planted.name)} went unanswered`)
  }
  const lastLine = (result.stdout ?? '').split('\n').filter((line) => line.trim() !== '').pop() ?? ''
  const terminal = lastLine.trim()
  const sentinelMatches = mode.kind === 'mutation'
    ? terminal.startsWith(`${mode.expectedSentinel} `)
    : terminal === mode.expectedSentinel
      || (result.status === INCONCLUSIVE_STATUS && terminal.startsWith(`${mode.expectedSentinel} — `))
  if (!sentinelMatches) {
    faults.push(`expected sentinel ${JSON.stringify(mode.expectedSentinel)} did not terminate stdout`)
  }

  if (mode.kind === 'additional') {
    if (rows.duplicateIds.length > 0) faults.push(`collected duplicate row ids: ${rows.duplicateIds.join(', ')}`)
    if (rows.unparsedLines.length > 0) faults.push(`unparseable court rows at lines: ${rows.unparsedLines.join(', ')}`)
    if (rows.keptBreach.size > 0) faults.push(`additional run emitted kept rows: ${sorted(rows.keptBreach).join(', ')}`)
    if (rows.raw.length > 0) faults.push('additional run unexpectedly emitted a row table')
    if (result.status !== mode.expectedExit) faults.push(`exited ${result.status}, expected ${mode.expectedExit}`)
  } else {
    if (rows.breach.size + rows.held.size + rows.inconclusive.size + rows.keptBreach.size === 0) {
      faults.push('collected NO rows')
    }
    if (rows.duplicateIds.length > 0) faults.push(`collected duplicate row ids: ${rows.duplicateIds.join(', ')}`)
    if (rows.unparsedLines.length > 0) faults.push(`unparseable court rows at lines: ${rows.unparsedLines.join(', ')}`)
    if (rows.keptBreach.size > 0) faults.push(`enrolled court emitted undeclared kept rows: ${sorted(rows.keptBreach).join(', ')}`)
    for (const row of rows.breach) {
      if (rows.held.has(row) || rows.inconclusive.has(row)) faults.push(`row ${row} appeared under more than one verdict`)
    }
    for (const row of rows.held) {
      if (rows.inconclusive.has(row)) faults.push(`row ${row} appeared under more than one verdict`)
    }
    if (e.restorationRow !== null && !rows.held.has(e.restorationRow)) {
      faults.push(`its own restoration row ${e.restorationRow} did not hold`)
    }
    if (mode.kind === 'mutation') {
      const breachDiff = diff(e.expectedBreachRows, rows.breach)
      const heldDiff = diff(e.expectedHeldRows, rows.held)
      if (result.status !== mode.expectedExit) faults.push(`exited ${result.status}, expected ${mode.expectedExit}`)
      if (breachDiff.missing.length > 0) faults.push(`mutation lost breach rows: ${breachDiff.missing.join(', ')}`)
      if (breachDiff.extra.length > 0) faults.push(`mutation added breach rows: ${breachDiff.extra.join(', ')}`)
      if (heldDiff.missing.length > 0) faults.push(`mutation lost held rows: ${heldDiff.missing.join(', ')}`)
      if (heldDiff.extra.length > 0) faults.push(`mutation added held rows: ${heldDiff.extra.join(', ')}`)
      if (rows.inconclusive.size > 0) faults.push(`mutation emitted inconclusive rows: ${sorted(rows.inconclusive).join(', ')}`)
      faults.push(...mutationResultFaults(text, mode.expectedVerdicts, e.expectedBreachRows))
    } else if (inconclusive) {
      const everyRow = [...e.expectedBreachRows, ...e.expectedHeldRows]
      const observed = new Set([...rows.breach, ...rows.held, ...rows.inconclusive])
      const rowDiff = diff(everyRow, observed)
      if (rows.inconclusive.size === 0) faults.push(`exited ${INCONCLUSIVE_STATUS} without an inconclusive row`)
      if (rowDiff.missing.length > 0) faults.push(`inconclusive run omitted rows: ${rowDiff.missing.join(', ')}`)
      if (rowDiff.extra.length > 0) faults.push(`inconclusive run added rows: ${rowDiff.extra.join(', ')}`)
    } else if (result.status === 0) {
      const everyRow = [...e.expectedBreachRows, ...e.expectedHeldRows]
      const rowDiff = diff(everyRow, rows.held)
      if (rows.breach.size > 0) faults.push(`resolved run still has breach rows: ${sorted(rows.breach).join(', ')}`)
      if (rows.inconclusive.size > 0) faults.push(`resolved run has inconclusive rows: ${sorted(rows.inconclusive).join(', ')}`)
      if (rowDiff.missing.length > 0) faults.push(`resolved run omitted held rows: ${rowDiff.missing.join(', ')}`)
      if (rowDiff.extra.length > 0) faults.push(`resolved run added rows: ${rowDiff.extra.join(', ')}`)
    } else {
      const breachDiff = diff(e.expectedBreachRows, rows.breach)
      const heldDiff = diff(e.expectedHeldRows, rows.held)
      if (result.status !== e.expectedExit) faults.push(`exited ${result.status}, enrolled ${e.expectedExit}`)
      if (breachDiff.missing.length > 0) faults.push(`enrolled breach rows did not breach: ${breachDiff.missing.join(', ')}`)
      if (breachDiff.extra.length > 0) faults.push(`unenrolled rows breached: ${breachDiff.extra.join(', ')}`)
      if (heldDiff.missing.length > 0) faults.push(`required held rows did not hold: ${heldDiff.missing.join(', ')}`)
      if (heldDiff.extra.length > 0) faults.push(`unenrolled rows held: ${heldDiff.extra.join(', ')}`)
      if (rows.inconclusive.size > 0) faults.push(`breach run emitted inconclusive rows: ${sorted(rows.inconclusive).join(', ')}`)
    }
  }

  if (faults.length > 0) {
    recordClassification(identity, 'unexpected', result, elapsedMs, armStarted, faults)
    red++
    unexpected.push(label)
    console.log(`\nFAIL  UNEXPECTED GATE FAILURE — ${label} (exit ${result.status}, ${elapsedMs} ms)`)
    for (const fault of faults) console.log(`        ${fault}`)
    return
  }
  if (mode.kind === 'mutation') {
    if (mode.classification === 'skip') {
      recordClassification(identity, 'skip', result, elapsedMs, armStarted)
      skipCount++
      console.log(`\nSKIP  platform-gated counterfactual ${e.court} (${elapsedMs} ms)`)
    } else {
      recordClassification(identity, 'counterfactual', result, elapsedMs, armStarted)
      mutationDetectedCount++
      console.log(`\nCOUNTERFACTUAL DETECTED  ${e.court} (${elapsedMs} ms)`)
    }
    return
  }
  if (mode.kind === 'additional') {
    if (mode.classification === 'skip') {
      recordClassification(identity, 'skip', result, elapsedMs, armStarted)
      skipCount++
      console.log(`\nSKIP  ${e.court} ${mode.label} (${elapsedMs} ms)`)
    } else {
      recordClassification(identity, 'known-breach', result, elapsedMs, armStarted)
      breachCount++
      console.log(`\nBREACH  ${e.court} ${mode.label} (${elapsedMs} ms)`)
    }
    return
  }
  if (inconclusive) {
    recordClassification(identity, 'inconclusive', result, elapsedMs, armStarted)
    inconclusiveCount++
    inconclusiveCourts.push(`known-breach ${e.court}`)
    console.log(`\nUNVERIFIED  known-breach ${e.court} (${elapsedMs} ms)`)
    return
  }
  if (result.status === 0) {
    recordClassification(identity, 'resolved', result, elapsedMs, armStarted)
    resolvedCount++
    resolvedCourts.push(e.court)
    console.log(`\nRESOLVED — PENDING INDEPENDENT ORACLE REVIEW  ${e.court} (${elapsedMs} ms)`)
    return
  }
  recordClassification(identity, 'known-breach', result, elapsedMs, armStarted)
  breachCount++
  console.log(`\nBREACH  known-breach ${e.court} — reproduced as enrolled (${elapsedMs} ms)`)
  console.log(planted.name === null
    ? '        NO RUNNER CHALLENGE; this verdict remains forgeable by the court author.'
    : `        runner challenge answered from ${e.runnerChallenge.plantIn}.`)
}

for (const e of enrolled) {
  runEnrolledMode(e, {
    kind: 'normal',
    args: [],
    expectedSentinel: e.expectedSentinel,
  })
  const platformSkip = e.mutation.platformSkips?.[process.platform]
  runEnrolledMode(e, {
    kind: 'mutation',
    args: e.mutation.args,
    classification: platformSkip === undefined ? 'counterfactual' : 'skip',
    expectedExit: platformSkip?.expectedExit ?? e.mutation.expectedExit,
    expectedSentinel: e.mutation.expectedSentinel,
    expectedVerdicts: platformSkip?.expectedVerdicts ?? e.mutation.expectedVerdicts,
  })
  for (const run of e.additionalRuns ?? []) {
    const outcome = run.outcomes[process.platform === 'linux' ? 'linux' : 'other']
    runEnrolledMode(e, {
      kind: 'additional',
      label: run.label,
      args: run.args,
      ...outcome,
    })
  }
}

// ---------------------------------------------------------------------------
// The headline reconciles every scheduled subprocess into exactly one primary
// bucket. Known and kept breaches are never passes. Counterfactual detection is
// evidence about the runner, not evidence that the ordinary subject holds.
// ---------------------------------------------------------------------------
const scheduledRunCount = EXPECTED_GATE_RUNS.length
const headline = {
  passed: okCount,
  skipped: skipCount,
  inconclusive: inconclusiveCount,
  keptBreach: keptBreachRunCount,
  knownBreach: breachCount,
  resolved: resolvedCount,
  mutationDetected: mutationDetectedCount,
  unexpected: red,
}
const classifiedCount = classifiedRunCount(headline)
const finalWitness = gitWitness()
const finalSubject = REPORT_ENABLED ? gitSubjectWitness() : null
const accountingFaults = [
  ...gateRosterFaults(observedRunRoster).map(fault => `dispatch ledger: ${fault}`),
  ...gateRosterFaults([...classifiedRuns.keys()]).map(fault => `classification ledger: ${fault}`),
  ...baselineFaults(gateBaseline, finalWitness, 'final gate tree'),
  ...toolchainFaults(toolchainBaseline, runnerToolchainWitness(), 'final gate toolchain'),
  ...indexFlagFaults().map(fault => `final gate index: ${fault}`),
]
if (finalSubject !== null && !finalSubject.ok) {
  accountingFaults.push(`final subject could not be witnessed: ${finalSubject.detail}`)
} else if (
  finalSubject !== null
  && initialSubject !== null
  && (finalSubject.commit !== initialSubject.commit || finalSubject.tree !== initialSubject.tree)
) {
  accountingFaults.push('checked-out commit or committed tree changed during the gate')
}
if (duplicateClassifications.size > 0) {
  accountingFaults.push(`duplicate classifications: ${[...duplicateClassifications].sort().join(', ')}`)
}
if (classifiedCount !== scheduledRunCount) {
  accountingFaults.push(`${classifiedCount} primary bucket entries for ${scheduledRunCount} scheduled runs`)
}
let accountingFailed = accountingFaults.length > 0
let finalStatus = red > 0 || accountingFailed ? 1 : inconclusiveCount > 0 ? INCONCLUSIVE_STATUS : 0
let report = null
let reportBuildError = null
if (REPORT_ENABLED) {
  try {
    if (initialSubject === null || pnpmVersion === null) {
      throw new Error('report subject witnesses were not collected')
    }
    report = buildCourtGateReport({
      subject: {
        commit: initialSubject.commit,
        tree: initialSubject.tree,
        headStable: finalSubject?.ok === true
          && finalSubject.commit === initialSubject.commit
          && finalSubject.tree === initialSubject.tree,
        checkout: {
          initial: reportCheckoutWitness(initialWitness),
          postBuild: reportCheckoutWitness(gateBaseline),
          final: reportCheckoutWitness(finalWitness),
        },
      },
      runtime: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        pnpm: pnpmVersion.version,
      },
      scheduledRunRoster,
      classifications: classifiedRuns,
      runResults,
      headline,
      dispatchedCount: observedRunRoster.length,
      classifiedCount,
      accountingFaults,
      finalStatus,
    })
  } catch (error) {
    reportBuildError = error instanceof Error ? error : new Error(String(error))
    accountingFaults.push(`report construction failed: ${reportBuildError.message}`)
    accountingFailed = true
    finalStatus = 1
  }
}
console.log(`\n  ${okCount} passed / ${skipCount} skipped / ${inconclusiveCount} inconclusive`)
const keptBreachRowCount = [...keptBreachRowsByCourt.values()].reduce((sum, rows) => sum + rows.length, 0)
const declaredRowLabel = `${keptBreachRowCount} declared ${keptBreachRowCount === 1 ? 'row' : 'rows'}`
console.log(`  ${keptBreachRunCount} kept-breach runs (${declaredRowLabel}) / ${breachCount} known breaches / ${resolvedCount} resolved`)
console.log(`  ${mutationDetectedCount} counterfactuals detected / ${red} unexpected failures`)
console.log(`  ${classifiedCount}/${scheduledRunCount} scheduled subprocesses classified`)
if (resolvedCount > 0) {
  console.log(`  ${resolvedCount} RESOLVED — PENDING INDEPENDENT ORACLE REVIEW: ${resolvedCourts.join(', ')}`)
}
if (accountingFailed) {
  for (const fault of accountingFaults) console.log(`  ACCOUNTING FAILURE: ${fault}`)
}
if (breachCount > 0 && finalStatus === 0) {
  console.log(`  The known breaches are open holes, enrolled in courts/known-breaches.json. The gate is`)
  console.log(`  green so the repair can merge; the system is not sound until they hold at the guest's euid.`)
  if (keptBreachRunCount > 0) console.log('  Aura R8 also remains a demonstrated coherent-forgery limitation; it is not a pass.')
} else if (breachCount > 0) {
  console.log(`  The known breaches remain open holes. Their expected reproduction does not override the`)
  console.log(`  non-green result reported below.`)
}
if (inconclusiveCount > 0) {
  console.log(`  INCONCLUSIVE — NOT GREEN: ${inconclusiveCourts.join(', ')}`)
  console.log('  At least one court completed without observing every subject it needs. Install or build the missing')
  console.log('  substrate and run the gate again; this result certifies neither enforcement nor a reproduced breach.')
}
if (red > 0) console.log(`  unexpected: ${unexpected.join(', ')}`)
let reportOutcome = { exitCode: finalStatus, error: reportBuildError }
if (report !== null) {
  reportOutcome = persistCourtGateReportDescriptor(REPORT_DESCRIPTOR, report, finalStatus)
}
if (reportOutcome.error !== null) {
  console.error(`\n  *** GATE REPORT FAILED *** ${reportOutcome.error.message}`)
}
process.exitCode = reportOutcome.exitCode
