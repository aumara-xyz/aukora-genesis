/**
 * Same-UID source launcher for the governed 8088 assembly.
 *
 * This process sits above the guest, broker, and issuer. It creates one
 * literal activation profile, starts the broker and issuer, then starts the
 * real DSH profile with governed Loader semantics. The launch is useful for
 * source development and assembled demonstrations; every child still runs at
 * this process's uid, so it establishes process topology but not custody.
 *
 * @module @aukora/supervisor/developer-launch
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  chmodSync,
  lstatSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { isJsExpr } from '@deepseek-ai/cordis-plugin-loader'
import { load as loadYaml } from 'js-yaml'
import { parseWebCapsuleConfig, WEB_CAPSULE_DOMAIN } from './developer-web-capsule.mjs'
import { assertWebOperatorHost, composeWebOperatorPreset } from './developer-web-operator.mjs'
import { provisionBrokerIdentity, spawnBroker } from '../broker/broker.mjs'
import {
  ACTIVATION_STATEMENT_DOMAIN,
  activationDigest,
  parseActivationStatement,
} from '../activation/statement.mjs'
import {
  measureClosureMember,
  measureDigestManifest,
  measureVerifiedDigestManifest,
} from '../activation/measure.mjs'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'
import { receiptKeyIdForPublicKey } from '../host-dsh/src/grant.mjs'
import { verifierGraph } from '../host-dsh/src/verifier-bytes.mjs'
import { isExactMemoryPutArgs, KEY_SHAPE } from '../broker/memory-put-args.mjs'
import { WORKSPACE_NAME_SHAPE } from '../broker/workspace-patch-args.mjs'
import { buildOperation } from '../broker/operation.mjs'
import {
  createSubjectAuthorityContext,
  createSubjectAuthorityExpectation,
} from '../broker/subject-authority.mjs'
import { KIRA_RECALL_MAX_SUBJECT_BYTES } from '../kira/recall.mjs'
import { KIRA_PRIVACY_CLASSES } from '../kira/stage.mjs'
import { identityControlDigest, parseIdentityControlState } from '../identity/control.mjs'
import { MEMORY_PUT_PROPOSAL_WASM_SHA256 } from '../guest/wasm-proposal-cell.mjs'
import {
  AUKORA_MEMORY_INDETERMINATE,
  classifyMemoryToolResult,
} from '../broker/public-outcome.mjs'
import {
  DEVELOPER_LAUNCH_SCHEMA,
  DEVELOPER_OBSERVATION_CLASS,
  GUEST_EXECUTE_TYPE,
  GUEST_READY_TYPE,
  GUEST_RESULT_TYPE,
  GUEST_TURN_TYPE,
  LIVE_TURN_SCHEMA,
  SOURCE_OUTCOME_INDETERMINATE,
  SOURCE_OUTCOME_REFUSED,
  SOURCE_OUTCOME_SETTLED,
  sourceOutcomeExitCode,
} from './developer-protocol.mjs'
import {
  DEVELOPER_AUMLOK_PROJECTION_ENV,
  serializeDeveloperAumlokProjection,
} from './developer-aumlok.mjs'
import {
  CONFINED_OBSERVATION_CLASS,
  prepareGuestConfinement,
  requireGuestConfinement,
  spawnConfinedGuest,
  verifyGuestConfinement,
} from './guest-confinement.mjs'
import { DeveloperLaunchError } from './developer-launch-error.mjs'
import { installIssuerApprovalBridge } from './issuer-approval-bridge.mjs'

export { DeveloperLaunchError } from './developer-launch-error.mjs'
export { installIssuerApprovalBridge } from './issuer-approval-bridge.mjs'

export {
  DEVELOPER_LAUNCH_SCHEMA,
  DEVELOPER_OBSERVATION_CLASS,
  GUEST_EXECUTE_TYPE,
  GUEST_READY_TYPE,
  GUEST_RESULT_TYPE,
  GUEST_TURN_TYPE,
  LIVE_TURN_SCHEMA,
  SOURCE_OUTCOME_INDETERMINATE,
  SOURCE_OUTCOME_REFUSED,
  SOURCE_OUTCOME_SETTLED,
  sourceOutcomeExitCode,
} from './developer-protocol.mjs'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const PROFILE_NAME = '8088-inside-out'
const PROFILE_SOURCE = join(ROOT, 'profiles', PROFILE_NAME)
const PROFILE_MANIFEST = join(PROFILE_SOURCE, 'package.json')
const PROFILE_PATCH = join(PROFILE_SOURCE, 'cordis.patch.yml')
const WEB_PROFILE_NAME = 'aukora-web'
const WEB_PROFILE_SOURCE = join(ROOT, 'profiles', WEB_PROFILE_NAME)
const WEB_PROFILE_MANIFEST = join(WEB_PROFILE_SOURCE, 'package.json')
const WEB_PROFILE_PATCH = join(WEB_PROFILE_SOURCE, 'cordis.patch.yml')
const WEB_CAPSULE_OVERLAY = join(ROOT, 'profiles', 'web', 'helix-capsule.overlay.yml')
const WEB_CAPSULE_CONFIG_ENTRY = join(ROOT, 'aukora', 'supervisor', 'developer-web-capsule.mjs')
const WEB_PRESET_SOURCE = join(ROOT, 'apps', 'cli', 'config', 'agent-presets', 'aukora')
const WEB_PRESET_MANIFEST = join(WEB_PRESET_SOURCE, 'preset.yml')
const WEB_PRESET_COMPOSITION = join(WEB_PRESET_SOURCE, 'agent.cordis.yml')
const WEB_STANDARD_PRESET = join(ROOT, 'apps', 'cli', 'config', 'agent-presets', 'standard', 'agent.cordis.yml')
const WEB_OPERATOR_ENTRY = join(ROOT, 'aukora', 'supervisor', 'developer-web-operator.mjs')
const WEB_AUMLOK_SUBJECT_LITERAL = 'aumlok:subject:local-web'
const PROFILE_BOOT = join(ROOT, 'apps', 'cli', 'src', 'profile-boot.ts')
const PREPARED_PROFILE_BOOT = join(ROOT, 'apps', 'cli', 'lib', 'profile-boot.js')
const GUEST_CONFINEMENT_ENTRY = join(ROOT, 'aukora', 'supervisor', 'guest-confinement.mjs')
const BUNDLE_BASE_SOURCE = join(ROOT, 'packages', 'bundle', 'base')
const BUNDLE_BASE_MANIFEST = join(BUNDLE_BASE_SOURCE, 'package.json')
const BUNDLE_BASE_PATCH = join(BUNDLE_BASE_SOURCE, 'cordis.patch.yml')
const BUNDLE_WEB_APP_SOURCE = join(ROOT, 'packages', 'bundle', 'web-app')
const BUNDLE_WEB_APP_MANIFEST = join(BUNDLE_WEB_APP_SOURCE, 'package.json')
const BUNDLE_WEB_APP_PATCH = join(BUNDLE_WEB_APP_SOURCE, 'cordis.patch.yml')
// Frozen census of Loader executable-expression leaves the two selected Web
// bundles carry today, keyed by row id, measured with the Loader's own
// entryListSchema/isJsExpr rather than a hand-rolled scan. A changed count or
// row set means the bundles moved and the parent-staged literal overrides
// below no longer provably cover every surviving expression, so launch
// refuses by name instead of silently proceeding on a stale assumption.
const EXPECTED_WEB_EXECUTABLE_CENSUS = Object.freeze({
  'session-persistence-jsonl': 1,
  'session-telemetry-otel': 2,
  'sandbox-policy': 2,
  'bash-sandbox': 1,
  'pwsh-sandbox': 1,
  approval: 1,
  'tool-bash': 1,
  'tool-pwsh': 1,
  tools: 1,
  'storage-json': 1,
  webserver: 2,
  'web-runtime': 2,
  connection: 1,
})
const DEVELOPER_LAUNCH_ENTRY = fileURLToPath(import.meta.url)
const ISSUER_APPROVAL_BRIDGE_ENTRY = join(ROOT, 'aukora', 'supervisor', 'issuer-approval-bridge.mjs')
const DEVELOPER_LAUNCH_ERROR_ENTRY = join(ROOT, 'aukora', 'supervisor', 'developer-launch-error.mjs')
const DEVELOPER_LAUNCH_BIN_ENTRY = join(ROOT, 'aukora', 'supervisor', 'developer-launch-bin.mjs')
const LIVE_TURN_BIN_ENTRY = join(ROOT, 'aukora', 'supervisor', 'developer-live-turn-bin.mjs')
const WEB_BIN_ENTRY = join(ROOT, 'aukora', 'supervisor', 'developer-web-bin.mjs')
const DEVELOPER_TERMINAL_ENTRY = join(ROOT, 'aukora', 'supervisor', 'developer-terminal.mjs')
const DEVELOPER_REVIEW_ENTRY = join(ROOT, 'aukora', 'supervisor', 'developer-review.mjs')
const WEB_REVIEW_CLIENT_ENTRY = join(ROOT, 'scripts', 'aukora-web-review.mjs')
const OWNER_BROWSER_MEMBERS = [
  ['owner-review-server', 'aukora/supervisor/owner-review-server.mjs'],
  ['chat-owner-client', 'packages/client/ui-conversation/src/client/owner-review.ts'],
  ['chat-owner-panel', 'packages/client/ui-conversation/src/client/skeleton/OwnerReviewPanel.tsx'],
  ['chat-approval-card', 'packages/client/ui-conversation/src/client/skeleton/ApprovalPanel.tsx'],
  ['chat-approval-style', 'packages/client/ui-conversation/src/client/skeleton/ApprovalPanel.module.css'],
].map(([name, path]) => ({ name, path: join(ROOT, path) }))
const REVIEW_TRANSPORT_ENTRY = join(ROOT, 'scripts', 'launchd-review-transport.mjs')
const REVIEW_SOCKET_ENTRY = join(ROOT, 'scripts', 'launchd-socket-listener.mjs')
const DEVELOPER_AUMLOK_ENTRY = join(ROOT, 'aukora', 'supervisor', 'developer-aumlok.mjs')
const LOCAL_AUMLOK_CONTROL_ENTRY = join(ROOT, 'aukora', 'identity', 'local-control-store.mjs')
const GUEST_ENTRY = join(ROOT, 'aukora', 'supervisor', 'developer-guest.mjs')
const LIVE_TURN_GUEST_ENTRY = join(ROOT, 'aukora', 'supervisor', 'developer-guest-turn.mjs')
const WEB_GUEST_ENTRY = join(ROOT, 'aukora', 'supervisor', 'developer-web-guest.mjs')
const LIVE_TURN_OVERLAY = join(ROOT, 'aukora', 'supervisor', 'live-turn.overlay.yml')
const LIVE_TURN_FIXTURE_OVERLAY = join(ROOT, 'aukora', 'supervisor', 'live-turn-fixture.overlay.yml')
const LIVE_TURN_FIXTURE_LLM = join(ROOT, 'aukora', 'supervisor', 'live-turn-fixture-llm.ts')
const BROKER_ENTRY = join(ROOT, 'aukora', 'broker', 'broker.mjs')
const ISSUER_ENTRY = join(ROOT, 'aukora', 'issuer', 'issuer.mjs')
const VERIFIER_GRAPH_ENTRY = join(ROOT, 'aukora', 'host-dsh', 'src', 'verifier-bytes.mjs')
const ACTIVATION_STATEMENT_ENTRY = join(ROOT, 'aukora', 'activation', 'statement.mjs')
const ACTIVATION_MEASURE_ENTRY = join(ROOT, 'aukora', 'activation', 'measure.mjs')
const ROOT_PACKAGE_MANIFEST = join(ROOT, 'package.json')
const WORKSPACE_LOCK = join(ROOT, 'pnpm-lock.yaml')
const WORKSPACE_LAYOUT = join(ROOT, 'pnpm-workspace.yaml')
const TSCONFIG_ROOT = join(ROOT, 'tsconfig.json')
const TSCONFIG_BASE = join(ROOT, 'tsconfig.base.json')
const TSCONFIG_HOST = join(ROOT, 'tsconfig.host.json')
const BROKER_LITERAL = "brokerSocket: '/run/aukora/broker.sock'"
/** Broker placeholders the reviewed Web profile must carry: memory and the patch adapter. */
const WEB_BROKER_ROUTE_COUNT = 2
/** Reviewed source bytes for the four-row 8088 profile before route substitution. */
export const SOURCE_PROFILE_PATCH_SHA256 = '3113780e9b0172d11b95f29406fa9b64804fac718983286d73f20fdc87e9ce09'
/**
 * Digest of the CLI module that owns the source launcher's terminal pixels,
 * challenge generation, and input event handling.
 *
 * Library embedders must supply their own renderer digest instead of inheriting
 * this identity for an arbitrary callback.
 */
export const SOURCE_RENDERER_ID = fileSha256(DEVELOPER_LAUNCH_BIN_ENTRY)
/** SHA-256 of the parent terminal renderer used by the Web source command. */
export const WEB_RENDERER_ID = fileSha256(DEVELOPER_TERMINAL_ENTRY)
/** This assembly mounts no model, so no request may leave it. Stated rather than assumed. */
export const SOURCE_MODEL_EMISSION_POLICY = 'aukora:model-emission:none:v1'
/** Parent-staged loop overlay; a real model may run. Credentials still do not authorize writes. */
export const LIVE_TURN_MODEL_EMISSION_POLICY = 'aukora:model-emission:parent-staged-loop:v1'
/** Same loop overlay with the fixture adapter selected. Still not a write grant. */
export const LIVE_TURN_FIXTURE_MODEL_EMISSION_POLICY = 'aukora:model-emission:parent-staged-loop-fixture:v1'
/** Browser loop over the parent-staged Web profile; browser data grants no authority. */
export const WEB_MODEL_EMISSION_POLICY = 'aukora:model-emission:parent-staged-web:v1'
/** Reviewed bytes of the parent-staged live-turn overlay. */
export const SOURCE_LIVE_TURN_OVERLAY_SHA256 = '7bcdbdacf96731cf08390acfb0c1be4b4da6b258067b1c682ebb697aed15b61d'
/** Reviewed bytes of the keyless fixture overlay. */
export const SOURCE_LIVE_TURN_FIXTURE_OVERLAY_SHA256 = '6a9c96a556e93f3f843e6fb56c04e90ec787ff585c2309b96291a6bbb426ba32'
const SHA256 = /^[0-9a-f]{64}$/
const ZERO_DIGEST = '00'.repeat(32)
const PLAIN_PATH = /^[^\u0000-\u001f\u007f]+$/u
const MAX_UNIX_SOCKET_PATH_BYTES = 103
const MAX_CONFIG_BYTES = 64 * 1024
const MAX_OPERATION_BYTES = 8192
const GUEST_OPERATION_CEILING_MS = 80_000
const CONFIG_KEYS = [
  'schema',
  'runtimeDir',
  'rootPrivateKeyFile',
  'rootPublicKeyFile',
]
const KIRA_CONFIG_KEYS = ['kiraSubject', 'kiraPrivacy']
const SOURCE_OUTCOMES = new Set([
  SOURCE_OUTCOME_INDETERMINATE,
  SOURCE_OUTCOME_REFUSED,
  SOURCE_OUTCOME_SETTLED,
])

/**
 * Parse the exact JSON configuration accepted by the source launcher.
 * @param {string | Buffer | unknown} input - JSON bytes or a parsed value.
 * @returns {{schema: string, runtimeDir: string, rootPrivateKeyFile: string, rootPublicKeyFile: string,
 *   kiraSubject?: string, kiraPrivacy?: readonly string[]}} validated data.
 */
export function parseDeveloperLaunchConfig(input) {
  let value = input
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    if (Buffer.byteLength(input) > MAX_CONFIG_BYTES) {
      throw new DeveloperLaunchError('supervisor:launch-config-oversize', `configuration exceeds ${String(MAX_CONFIG_BYTES)} bytes`)
    }
    try {
      value = JSON.parse(input.toString())
    } catch (error) {
      throw new DeveloperLaunchError('supervisor:launch-config-malformed', error instanceof Error ? error.message : String(error))
    }
  }
  const hasKiraSubject = typeof value === 'object' && value !== null
    && Object.hasOwn(value, 'kiraSubject')
  const hasKiraPrivacy = typeof value === 'object' && value !== null
    && Object.hasOwn(value, 'kiraPrivacy')
  if (hasKiraSubject !== hasKiraPrivacy) {
    throw new DeveloperLaunchError(
      'supervisor:kira-recall-policy-invalid',
      'kiraSubject and kiraPrivacy must appear together',
    )
  }
  requireExactObject(
    value,
    hasKiraSubject ? [...CONFIG_KEYS, ...KIRA_CONFIG_KEYS] : CONFIG_KEYS,
    'supervisor:launch-config-fields',
  )
  if (value.schema !== DEVELOPER_LAUNCH_SCHEMA) {
    throw new DeveloperLaunchError('supervisor:launch-config-schema', `expected ${DEVELOPER_LAUNCH_SCHEMA}`)
  }
  for (const key of CONFIG_KEYS.slice(1)) requireAbsolutePath(value[key], key)
  if (value.rootPrivateKeyFile === value.rootPublicKeyFile) {
    throw new DeveloperLaunchError('supervisor:launch-key-paths-collide', 'private and public key paths must differ')
  }
  if (!hasKiraSubject) return Object.freeze({ ...value })
  const policy = readDeveloperKiraRecallPolicy({
    subject: value.kiraSubject,
    privacy: value.kiraPrivacy,
  })
  return Object.freeze({
    ...value,
    kiraSubject: policy.subject,
    kiraPrivacy: policy.privacy,
  })
}

/** Validate and detach the parent-owned KIRA recall policy. */
function readDeveloperKiraRecallPolicy(value) {
  requireExactObject(
    value,
    ['subject', 'privacy'],
    'supervisor:kira-recall-policy-invalid',
  )
  if (typeof value.subject !== 'string' || value.subject === ''
    || Buffer.byteLength(value.subject, 'utf8') > KIRA_RECALL_MAX_SUBJECT_BYTES
    || /[\u0000-\u001f\u007f-\u009f]/.test(value.subject)) {
    throw new DeveloperLaunchError(
      'supervisor:kira-recall-policy-invalid',
      'subject must be one non-empty control-free string',
    )
  }
  const privacy = value.privacy
  if (!Array.isArray(privacy) || Object.getPrototypeOf(privacy) !== Array.prototype
    || privacy.length === 0 || new Set(privacy).size !== privacy.length
    || Reflect.ownKeys(privacy).length !== privacy.length + 1
    || privacy.some(entry => !KIRA_PRIVACY_CLASSES.includes(entry))) {
    throw new DeveloperLaunchError(
      'supervisor:kira-recall-policy-invalid',
      `privacy must contain unique values from ${KIRA_PRIVACY_CLASSES.join(', ')}`,
    )
  }
  return Object.freeze({
    subject: value.subject,
    privacy: Object.freeze([...privacy].toSorted()),
  })
}

/** Validate one loopback Web selection owned by the launch parent. */
function readDeveloperWeb(value) {
  requireExactObject(value, ['port'], 'supervisor:web-config-invalid')
  if (!Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65535) {
    throw new DeveloperLaunchError('supervisor:web-config-invalid', 'port must be an integer from 1 through 65535')
  }
  return Object.freeze({ port: value.port })
}

/** Validate the public control projection and its active parent-owned control. */
function readDeveloperWebAumlok(projectionInput, rootControlInput, web) {
  if (web === undefined) {
    if (projectionInput !== undefined) {
      throw new DeveloperLaunchError(
        'supervisor:web-aumlok-projection-unexpected',
        'AUMLOK projection is available only to the Web assembly',
      )
    }
    return undefined
  }
  if (projectionInput === undefined || rootControlInput === undefined) {
    throw new DeveloperLaunchError(
      'supervisor:web-aumlok-control-unavailable',
      'the Web assembly requires one projected active AUMLOK control',
    )
  }
  let json
  let projection
  let control
  try {
    json = serializeDeveloperAumlokProjection(projectionInput)
    projection = JSON.parse(json)
    control = parseIdentityControlState(rootControlInput)
  } catch (error) {
    throw new DeveloperLaunchError(
      'supervisor:web-aumlok-control-invalid',
      error instanceof Error ? error.message : String(error),
    )
  }
  if (control.revoked
    || projection.subject !== control.subject
    || projection.epoch !== control.epoch
    || projection.activeControlDigest !== identityControlDigest(control)) {
    throw new DeveloperLaunchError(
      'supervisor:web-aumlok-control-mismatch',
      'the public projection must name the active non-revoked control head',
    )
  }
  return Object.freeze({ json, projection: Object.freeze(projection) })
}

/**
 * Resolve the parent-selected subject authority after the activation is final.
 *
 * The context must bind that exact digest before it can reach the broker. The
 * activation statement does not carry the delegation claims themselves; a
 * successful v5 action and its retained authority evidence bind the selected
 * context to this digest.
 *
 * @param {((activationDigest: string) => unknown) | undefined} createSubjectAuthority - parent factory.
 * @param {string} expectedActivationDigest - finalized launch activation.
 * @param {{subject: string, privacy: readonly string[]} | undefined} kiraRecallPolicy - optional parent recall policy.
 * @returns {Readonly<Record<string, unknown>> | undefined} detached broker context.
 */
function resolveDeveloperSubjectAuthority(
  createSubjectAuthority,
  expectedActivationDigest,
  kiraRecallPolicy,
) {
  if (createSubjectAuthority === undefined) return undefined
  let context
  try {
    context = createSubjectAuthorityContext(createSubjectAuthority(expectedActivationDigest))
  } catch (error) {
    throw new DeveloperLaunchError(
      'supervisor:subject-authority-context-invalid',
      error instanceof Error ? error.message : String(error),
    )
  }
  if (context.activationDigest !== expectedActivationDigest) {
    throw new DeveloperLaunchError(
      'supervisor:subject-authority-activation-mismatch',
      'the selected context must bind this launch activation',
    )
  }
  if (kiraRecallPolicy !== undefined && context.subject !== kiraRecallPolicy.subject) {
    throw new DeveloperLaunchError(
      'supervisor:subject-authority-kira-subject-mismatch',
      'the selected context and KIRA recall policy must name the same subject',
    )
  }
  return context
}

/** Validate and detach the proposal-specific authority selection before activation. */
function readDeveloperDynamicSubjectAuthority(
  selectSubjectAuthority,
  subjectAuthorityExpectation,
  kiraRecallPolicy,
  webAumlok,
) {
  const hasSelector = selectSubjectAuthority !== undefined
  const hasExpectation = subjectAuthorityExpectation !== undefined
  if (hasSelector !== hasExpectation) {
    throw new DeveloperLaunchError(
      'supervisor:dynamic-subject-authority-incomplete',
      'selectSubjectAuthority and subjectAuthorityExpectation must appear together',
    )
  }
  if (!hasSelector) return undefined
  if (typeof selectSubjectAuthority !== 'function') {
    throw new DeveloperLaunchError(
      'supervisor:dynamic-subject-authority-selector-invalid',
      'selectSubjectAuthority must be a function',
    )
  }
  let expectation
  try {
    requireExactObject(
      subjectAuthorityExpectation,
      ['subject', 'activeControlDigest', 'audience'],
      'supervisor:dynamic-subject-authority-expectation-invalid',
    )
    expectation = createSubjectAuthorityExpectation({
      subject: subjectAuthorityExpectation.subject,
      activeControlDigest: subjectAuthorityExpectation.activeControlDigest,
      activationDigest: ZERO_DIGEST,
      audience: subjectAuthorityExpectation.audience,
    })
  } catch (error) {
    if (error instanceof DeveloperLaunchError) throw error
    throw new DeveloperLaunchError(
      'supervisor:dynamic-subject-authority-expectation-invalid',
      error instanceof Error ? error.message : String(error),
    )
  }
  if (kiraRecallPolicy !== undefined && expectation.subject !== kiraRecallPolicy.subject) {
    throw new DeveloperLaunchError(
      'supervisor:subject-authority-kira-subject-mismatch',
      'the selected subject and KIRA policy must name the same subject',
    )
  }
  if (webAumlok !== undefined
    && (expectation.subject !== webAumlok.projection.subject
      || expectation.activeControlDigest !== webAumlok.projection.activeControlDigest)) {
    throw new DeveloperLaunchError(
      'supervisor:web-aumlok-authority-mismatch',
      'the proposal authority expectation must name the projected active control',
    )
  }
  return Object.freeze({
    selectSubjectAuthority,
    subjectAuthorityExpectation: Object.freeze({
      subject: expectation.subject,
      activeControlDigest: expectation.activeControlDigest,
      audience: expectation.audience,
    }),
  })
}

/** Add the finalized activation digest to one prevalidated dynamic selection. */
function bindDeveloperDynamicSubjectAuthority(selection, expectedActivationDigest) {
  if (selection === undefined) return undefined
  return Object.freeze({
    selectSubjectAuthority: selection.selectSubjectAuthority,
    subjectAuthorityExpectation: createSubjectAuthorityExpectation({
      ...selection.subjectAuthorityExpectation,
      activationDigest: expectedActivationDigest,
    }),
  })
}

/** Parse one exact memory.put operation for the optional one-shot command. */
export function parseDeveloperMemoryPut(input) {
  let value = input
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    if (Buffer.byteLength(input) > MAX_OPERATION_BYTES) {
      throw new DeveloperLaunchError('supervisor:operation-oversize', `operation file exceeds ${String(MAX_OPERATION_BYTES)} bytes`)
    }
    try {
      value = JSON.parse(input.toString())
    } catch (error) {
      throw new DeveloperLaunchError('supervisor:operation-malformed', error instanceof Error ? error.message : String(error))
    }
  }
  if (!isExactMemoryPutArgs(value) || !KEY_SHAPE.test(value.key)) {
    throw new DeveloperLaunchError('supervisor:operation-fields', 'expected exactly one valid memory.put { key, value } object')
  }
  const key = Object.getOwnPropertyDescriptor(value, 'key')?.value
  const inputValue = Object.getOwnPropertyDescriptor(value, 'value')?.value
  const snapshot = snapshotDeveloperJsonValue(inputValue)
  if (typeof key !== 'string' || snapshot === INVALID_JSON_VALUE) {
    throw new DeveloperLaunchError('supervisor:operation-json-value', 'memory.put value must be lossless JSON data')
  }
  const operation = Object.freeze({ key, value: snapshot })
  if (Buffer.byteLength(JSON.stringify(operation), 'utf8') > MAX_OPERATION_BYTES
    || buildOperation(operation, 0).bytes > MAX_OPERATION_BYTES) {
    throw new DeveloperLaunchError('supervisor:operation-oversize', `operation exceeds ${String(MAX_OPERATION_BYTES)} bytes`)
  }
  return operation
}

const LIVE_TURN_KEYS = ['schema', 'prompt']

/**
 * Detach operator-owned workspace aliases and exclude authority/state locations.
 * @param {Readonly<Record<string,string>>} input - names mapped to canonical existing directories.
 * @param {readonly string[]} protectedPaths - controller, data, runtime, or key paths that must not overlap a workspace.
 * @returns {Readonly<Record<string,string>>} frozen aliases, without creating files or directories.
 * @throws {DeveloperLaunchError} when a name, root, or protected-path separation is invalid.
 */
export function readDeveloperWorkspaceRoots(input, protectedPaths = []) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new DeveloperLaunchError('supervisor:workspace-roots-invalid', 'expected an alias-to-directory record')
  }
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new DeveloperLaunchError('supervisor:workspace-roots-invalid', 'expected plain own data properties')
  }
  const descriptors = Object.getOwnPropertyDescriptors(input)
  const protectedRoots = protectedPaths.map(canonicalProspectivePath)
  const roots = Object.create(null)
  for (const alias of Reflect.ownKeys(descriptors)) {
    if (typeof alias !== 'string' || !WORKSPACE_NAME_SHAPE.test(alias)) {
      throw new DeveloperLaunchError('supervisor:workspace-alias-invalid', 'workspace aliases must be names, not paths')
    }
    const descriptor = descriptors[alias]
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new DeveloperLaunchError('supervisor:workspace-roots-invalid', 'workspace roots must be enumerable data values')
    }
    const root = descriptor.value
    if (typeof root !== 'string' || !isAbsolute(root) || resolve(root) !== root) {
      throw new DeveloperLaunchError('supervisor:workspace-root-not-canonical', String(alias))
    }
    let stat
    let canonical
    try {
      stat = lstatSync(root)
      canonical = realpathSync(root)
    } catch {
      throw new DeveloperLaunchError('supervisor:workspace-root-unavailable', alias)
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || canonical !== root) {
      throw new DeveloperLaunchError('supervisor:workspace-root-not-canonical', alias)
    }
    if (protectedRoots.some(path => pathsOverlap(root, path))) {
      throw new DeveloperLaunchError('supervisor:workspace-protected-path-overlap', alias)
    }
    roots[alias] = root
  }
  return Object.freeze(roots)
}

/** Resolve existing ancestors before comparing protected directories that may not exist yet. */
function canonicalProspectivePath(input) {
  if (typeof input !== 'string' || !isAbsolute(input)) {
    throw new DeveloperLaunchError('supervisor:workspace-protected-path-invalid', 'expected an absolute protected path')
  }
  const tail = []
  let existing = resolve(input)
  for (;;) {
    try {
      lstatSync(existing)
    } catch (error) {
      if (error?.code !== 'ENOENT' || dirname(existing) === existing) {
        throw new DeveloperLaunchError('supervisor:workspace-protected-path-unavailable', input)
      }
      tail.unshift(relative(dirname(existing), existing))
      existing = dirname(existing)
      continue
    }
    try {
      return resolve(realpathSync(existing), ...tail)
    } catch {
      throw new DeveloperLaunchError('supervisor:workspace-protected-path-unavailable', input)
    }
  }
}

/** Compare complete path segments, including filesystem roots. */
function pathsOverlap(left, right) {
  const contains = (outer, inner) => {
    const path = relative(outer, inner)
    return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
  }
  return contains(left, right) || contains(right, left)
}

/** Parse one exact user-turn prompt for the parent-staged loop command. */
export function parseDeveloperLiveTurn(input) {
  let value = input
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    if (Buffer.byteLength(input) > MAX_OPERATION_BYTES) {
      throw new DeveloperLaunchError('supervisor:live-turn-oversize', `turn file exceeds ${String(MAX_OPERATION_BYTES)} bytes`)
    }
    try {
      value = JSON.parse(input.toString())
    } catch (error) {
      throw new DeveloperLaunchError('supervisor:live-turn-malformed', error instanceof Error ? error.message : String(error))
    }
  }
  requireExactObject(value, LIVE_TURN_KEYS, 'supervisor:live-turn-fields')
  if (value.schema !== LIVE_TURN_SCHEMA) {
    throw new DeveloperLaunchError('supervisor:live-turn-schema', `expected ${LIVE_TURN_SCHEMA}`)
  }
  const prompt = Object.getOwnPropertyDescriptor(value, 'prompt')?.value
  if (typeof prompt !== 'string' || prompt.length === 0 || Buffer.byteLength(prompt, 'utf8') > MAX_OPERATION_BYTES) {
    throw new DeveloperLaunchError('supervisor:live-turn-prompt', 'expected one nonempty prompt string within 8192 bytes')
  }
  return Object.freeze({ schema: LIVE_TURN_SCHEMA, prompt })
}

/**
 * Start the broker, issuer, and governed DSH guest beneath one parent.
 * @param {object} options - Validated launch inputs and parent-owned decisions.
 * @param {string} options.runtimeDir - New private directory for this launch.
 * @param {string} options.rootPrivateKeyFile - Issuer-owned Ed25519 PKCS8 file.
 * @param {string} options.rootPublicKeyFile - Ed25519 SPKI file read by the parent and broker.
 * @param {unknown} [options.rootControlState] - active hybrid AUMLOK control head persisted by the broker.
 * @param {string} options.rendererId - SHA-256 identity of the parent-owned review implementation.
 * @param {string} [options.reviewConfigurationDigest] - SHA-256 identity of the parent-owned reconnectable review configuration.
 * @param {(request: object, signal: AbortSignal) => Promise<'approved'|'denied'>|'approved'|'denied'} options.review - Exact-operation parent review.
 * @param {import('./developer-launch.mjs').DeveloperIssuerApproval} options.issuerApproval - Signing decision after parent review; unavailable leaves the issuer's deadline active without answering.
 * @param {(text: string) => void} [options.issuerStderr] - Synchronous sink for the issuer's own projection.
 * @param {{fixture?: boolean}} [options.liveTurn] - Parent-staged loop overlay; fixture selects the keyless adapter.
 * @param {{port: number}} [options.web] - Parent-staged loopback Web surface.
 * @param {'macos-seatbelt'} [options.guestConfinement] - Require OS restrictions for the prepared keyless 8088 guest.
 * @param {{subject: string, privacy: readonly string[]}} [options.kiraRecallPolicy] -
 *   parent-owned recall subject and privacy policy; required by the live-turn composition.
 * @param {(activationDigest: string) => unknown} [options.createSubjectAuthority] -
 *   parent-owned factory for one session-to-Agent context. It receives the
 *   finalized activation digest and must return a context bound to it before
 *   the broker child starts.
 * @param {(request: object, signal: AbortSignal) => unknown} [options.selectSubjectAuthority] -
 *   parent selector for one proposal-specific session-to-Agent context.
 * @param {{subject: string, activeControlDigest: string, audience: string}} [options.subjectAuthorityExpectation] -
 *   public identity fields required from every proposal-specific selection.
 * @param {object} [options.webAumlokProjection] - five public AUMLOK fields exposed to the Web guest.
 * @returns {Promise<import('./developer-launch.mjs').DeveloperAssembly>} the live assembly handle.
 */
export async function launchDeveloperAssembly(options) {
  const guestConfinement = options?.guestConfinement
  if (guestConfinement !== undefined) {
    requireGuestConfinement(guestConfinement)
    if (options.liveTurn !== undefined || options.web !== undefined) {
      throw new DeveloperLaunchError('supervisor:confined-keyless-only', 'confinement selects only the keyless 8088 guest')
    }
  }
  if (typeof options?.review !== 'function') {
    throw new DeveloperLaunchError('supervisor:review-channel-unavailable', 'review callback is required')
  }
  if (typeof options?.issuerApproval !== 'function') {
    throw new DeveloperLaunchError('supervisor:issuer-approval-channel-unavailable', 'issuer approval callback is required')
  }
  const createSubjectAuthority = options.createSubjectAuthority
  if (createSubjectAuthority !== undefined && typeof createSubjectAuthority !== 'function') {
    throw new DeveloperLaunchError('supervisor:subject-authority-factory-invalid', 'createSubjectAuthority must be a function')
  }
  const dynamicAuthorityRequested = options.selectSubjectAuthority !== undefined
    || options.subjectAuthorityExpectation !== undefined
  if (createSubjectAuthority !== undefined && dynamicAuthorityRequested) {
    throw new DeveloperLaunchError(
      'supervisor:subject-authority-mode-conflict',
      'static and proposal-specific subject authority are mutually exclusive',
    )
  }
  const liveTurn = options.liveTurn === undefined
    ? undefined
    : Object.freeze({ fixture: options.liveTurn.fixture === true })
  const web = options.web === undefined ? undefined : readDeveloperWeb(options.web)
  if (options.reviewConfigurationDigest !== undefined
    && (web === undefined || typeof options.reviewConfigurationDigest !== 'string'
      || !/^[0-9a-f]{64}$/u.test(options.reviewConfigurationDigest))) {
    throw new DeveloperLaunchError('supervisor:review-configuration-invalid', 'review configuration requires a Web launch and a SHA-256 digest')
  }
  if (liveTurn !== undefined && web !== undefined) {
    throw new DeveloperLaunchError('supervisor:surface-selection-invalid', 'liveTurn and web are mutually exclusive')
  }
  const kiraRecallPolicy = options.kiraRecallPolicy === undefined
    ? undefined
    : readDeveloperKiraRecallPolicy(options.kiraRecallPolicy)
  const webAumlok = readDeveloperWebAumlok(
    options.webAumlokProjection,
    options.rootControlState,
    web,
  )
  const dynamicAuthoritySelection = readDeveloperDynamicSubjectAuthority(
    options.selectSubjectAuthority,
    options.subjectAuthorityExpectation,
    kiraRecallPolicy,
    webAumlok,
  )
  if (web !== undefined && dynamicAuthoritySelection === undefined) {
    throw new DeveloperLaunchError(
      'supervisor:web-subject-authority-unavailable',
      'the Web assembly requires proposal-specific v5 subject authority',
    )
  }
  if ((liveTurn !== undefined || web !== undefined) && kiraRecallPolicy === undefined) {
    throw new DeveloperLaunchError(
      'supervisor:kira-recall-policy-unavailable',
      'the model composition requires a parent-owned KIRA recall policy',
    )
  }
  if (liveTurn !== undefined) validateLiveTurnOverlays(liveTurn.fixture)
  const dataDir = options.dataDir === undefined ? undefined : requireAbsoluteDataDir(options.dataDir)
  const config = parseDeveloperLaunchConfig({
    schema: DEVELOPER_LAUNCH_SCHEMA,
    runtimeDir: options.runtimeDir,
    rootPrivateKeyFile: options.rootPrivateKeyFile,
    rootPublicKeyFile: options.rootPublicKeyFile,
  })
  const issuerStderr = options.issuerStderr ?? ((text) => { process.stderr.write(text) })
  const workspaceRoots = options.workspaceRoots === undefined ? undefined : readDeveloperWorkspaceRoots(
    options.workspaceRoots,
    [config.runtimeDir, config.rootPrivateKeyFile, config.rootPublicKeyFile, ...(dataDir === undefined ? [] : [dataDir])],
  )
  const webCapsule = options.webCapsule === undefined ? undefined
    : parseWebCapsuleConfig({ domain: WEB_CAPSULE_DOMAIN, ...options.webCapsule })
  const webOperatorHome = readWebOperatorHome(options.webOperatorHome, web)
  if (webCapsule !== undefined && (web === undefined || dataDir === undefined
    || workspaceRoots === undefined || Object.keys(workspaceRoots).length === 0)) {
    throw new DeveloperLaunchError('supervisor:web-capsule-config-invalid', 'Capsule requires Web, a data root, and operator workspace aliases')
  }
  if (typeof issuerStderr !== 'function') {
    throw new DeveloperLaunchError('supervisor:issuer-stderr-invalid', 'issuerStderr must be a function')
  }

  let broker
  let issuer
  let guest
  /** Global tool names the current guest reported, replaced on every guest spawn. */
  let guestGlobalTools = Object.freeze([])
  let removeGuestFailureListener
  let closing = false
  let published = false
  let startupFailure
  let closePromise
  let restartPromise
  let operationActive = false
  let rejectFailure
  const failure = new Promise((_, reject) => { rejectFailure = reject })
  // The command-line owner races this promise immediately, but embedders may
  // attach later. Mark it handled without changing the promise they receive.
  void failure.catch(() => {})
  /** @type {Array<() => void>} */
  const removeFailureListeners = []
  const close = () => {
    if (closePromise !== undefined) return closePromise
    closing = true
    for (const remove of removeFailureListeners.splice(0)) remove()
    closePromise = (async () => {
      if (restartPromise !== undefined) await Promise.allSettled([restartPromise])
      const results = await Promise.allSettled([
        stopChild(guest, 'guest'),
        stopChild(broker, 'broker'),
        stopChild(issuer, 'issuer'),
      ])
      const failed = results.find(result => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    })()
    return closePromise
  }
  const failAssembly = (failureError) => {
    if (closing || startupFailure !== undefined) return
    if (!published) {
      startupFailure = failureError
      return
    }
    void close().then(
      () => { rejectFailure(failureError) },
      () => {
        // The originating assembly fault remains the failure signal; explicit
        // close callers receive any teardown error through the shared promise.
        rejectFailure(failureError)
      },
    )
  }
  const throwIfStartupFailed = () => {
    if (startupFailure !== undefined) throw startupFailure
  }

  try {
    const paths = prepareRuntime(config.runtimeDir, dataDir)
    // The broker identity is provisioned while the parent still owns the state
    // directory, so the activation can name the broker it will accept before
    // that broker exists — including the receipt verification key threaded
    // into the generated Capsule configuration below. Provisioning from the
    // eventual guest principal would defeat this ordering.
    const brokerIdentity = provisionBrokerIdentity(paths.stateDir)
    const stagedProfile = web === undefined
      ? stageActivationProfile(paths.activationHome, paths.brokerSocket)
      : stageWebActivationProfile(
        paths.activationHome,
        paths.brokerSocket,
        webAumlok.projection.subject,
        web.port,
        paths.activationHome,
        webCapsule === undefined ? undefined : { ...webCapsule, capsuleRoot: realpathSync(reuseDurableDirectory(join(dataDir, 'capsules'))), workspaceAliases: workspaceRoots, receiptPublicKeyPem: brokerIdentity.brokerPublicKeyPem },
        webOperatorHome,
      )
    if (guestConfinement !== undefined) prepareConfinedProfile(paths)
    const confinement = guestConfinement === undefined ? undefined : prepareGuestConfinement({
      root: ROOT, paths, issuerKey: config.rootPrivateKeyFile,
    })
    const rootPublicKeyPem = readExactPublicKey(config.rootPublicKeyFile)
    // The staged profile above already carries the provisioned receipt key;
    // the running broker is still bound to the same identity here.
    // LAUNCH VALIDATION. The statement is built and validated here, before the
    // first child is spawned. A malformed selection dies with a named refusal
    // and no process has started.
    const guestEntry = web !== undefined
      ? WEB_GUEST_ENTRY
      : liveTurn === undefined ? GUEST_ENTRY : LIVE_TURN_GUEST_ENTRY
    const activationInputs = Object.freeze({
      stagedManifestPath: stagedProfile.manifestPath,
      stagedPatchPath: stagedProfile.patchPath,
      stagedProfile,
      rendererId: options.rendererId,
      reviewConfigurationDigest: options.reviewConfigurationDigest,
      issuerId: receiptKeyIdForPublicKey(rootPublicKeyPem),
      brokerId: brokerIdentity.receiptKeyId,
      epoch: activationEpoch(dataDir),
      liveTurn,
      web,
      webAumlokProjection: webAumlok?.projection,
      kiraRecallPolicy,
      workspaceRoots,
      subjectAuthorityExpectation: dynamicAuthoritySelection?.subjectAuthorityExpectation,
      ...(confinement === undefined ? {} : { guestConfinement: {
        mode: guestConfinement, profileSha256: confinement.sha256,
      } }),
    })
    const activationStatement = buildSourceActivationStatement(activationInputs)
    const expectedActivationDigest = activationDigest(activationStatement)
    const assertRetainedActivation = () => {
      // The home patch layer is deliberately not a member of the statement, so
      // re-measuring cannot see one that appeared after READY. dsh composes it
      // above the staged profile, so every revalidation must look for it.
      assertNoHomeCompositionLayer(paths.activationHome)
      let retainedDigest
      try {
        retainedDigest = activationDigest(buildSourceActivationStatement(activationInputs))
      } catch {
        throw new DeveloperLaunchError(
          'supervisor:activation-input-changed',
          'the retained activation inputs can no longer be measured',
        )
      }
      if (retainedDigest !== expectedActivationDigest) {
        throw new DeveloperLaunchError(
          'supervisor:activation-input-changed',
          'the retained activation inputs no longer reproduce the running activation',
        )
      }
    }
    const subjectAuthority = resolveDeveloperSubjectAuthority(
      createSubjectAuthority,
      expectedActivationDigest,
      kiraRecallPolicy,
    )
    const dynamicSubjectAuthority = bindDeveloperDynamicSubjectAuthority(
      dynamicAuthoritySelection,
      expectedActivationDigest,
    )
    const artifact = Object.freeze({
      activationDigest: expectedActivationDigest,
      brokerEntrySha256: fileSha256(BROKER_ENTRY),
      guestEntrySha256: fileSha256(guestEntry),
      issuerEntrySha256: fileSha256(ISSUER_ENTRY),
      profileBootSha256: fileSha256(PROFILE_BOOT),
      profileManifestSha256: stagedProfile.manifestSha256,
      profilePatchSha256: stagedProfile.patchSha256,
      proposalCellModuleSha256: MEMORY_PUT_PROPOSAL_WASM_SHA256,
      sourceProfileManifestSha256: fileSha256(web === undefined ? PROFILE_MANIFEST : WEB_PROFILE_MANIFEST),
      sourceProfileSha256: fileSha256(web === undefined ? PROFILE_PATCH : WEB_PROFILE_PATCH),
      ...(confinement === undefined ? {} : { guestConfinementProfileSha256: confinement.sha256 }),
      ...(webAumlok === undefined ? {} : {
        aumlokProjectionSha256: sha256(Buffer.from(webAumlok.json, 'utf8')),
      }),
    })

    broker = await spawnBroker({
      socketPath: paths.brokerSocket,
      stateDir: paths.stateDir,
      rootPublicKeyPem,
      ...(options.rootControlState === undefined ? {} : { rootControlState: options.rootControlState }),
      issuerSocket: paths.issuerSocket,
      review: options.review,
      exitOnParentDisconnect: true,
      env: childEnvironment(),
      activationDigest: expectedActivationDigest,
      rendererId: options.rendererId,
      kiraRecallPolicy,
      workspaceRoots,
      subjectAuthority,
      ...dynamicSubjectAuthority,
    })
    watchChild(broker, 'broker')
    broker.stdout?.resume()
    broker.stderr?.resume()
    const status = await brokerRequest(paths.brokerSocket, { op: 'status' })
    throwIfStartupFailed()
    if (status?.ok !== true || typeof status.receiptKeyId !== 'string' || !SHA256.test(status.receiptKeyId)) {
      throw new DeveloperLaunchError('supervisor:broker-status-malformed', 'broker omitted its receipt key identity')
    }
    // The broker must report the activation the parent validated. Without this
    // the parent would have computed a digest nobody adopted, which is the
    // descriptive-hash posture this activation exists to replace.
    if (status.activationDigest !== expectedActivationDigest) {
      throw new DeveloperLaunchError(
        'supervisor:activation-not-bound',
        `broker serves ${String(status.activationDigest)}; this launch validated ${expectedActivationDigest}`,
      )
    }
    if (status.receiptKeyId !== brokerIdentity.receiptKeyId) {
      throw new DeveloperLaunchError(
        'supervisor:activation-broker-identity-changed',
        'the broker that started is not the broker this activation names',
      )
    }

    issuer = spawn(process.execPath, ['--', ISSUER_ENTRY], {
      cwd: ROOT,
      env: {
        AUKORA_ISSUER_SOCKET: paths.issuerSocket,
        AUKORA_ISSUER_KEY_FILE: config.rootPrivateKeyFile,
        AUKORA_EXPECTED_RECEIPT_KEY_ID: status.receiptKeyId,
      },
      stdio: ['pipe', 'ignore', 'pipe', 'ipc'],
    })
    watchChild(issuer, 'issuer')
    installIssuerApprovalBridge(issuer, options.issuerApproval, issuerStderr, failAssembly)
    await waitForSocket(paths.issuerSocket, issuer, 'issuer')
    throwIfStartupFailed()
    const guestEnv = guestEnvironment(
      paths,
      liveTurn,
      web,
      stagedProfile,
      webAumlok?.json,
      kiraRecallPolicy,
      confinement,
    )
    const spawnGuest = async () => {
      assertRetainedActivation()
      if (confinement !== undefined) await verifyGuestConfinement(confinement, guestEnv)
      const nextGuest = confinement === undefined ? spawn(process.execPath, ['--import', 'tsx/esm', guestEntry], {
        cwd: ROOT,
        env: guestEnv,
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      }) : spawnConfinedGuest(confinement, ['--', guestEntry, '--confined'], guestEnv)
      if (confinement !== undefined) {
        let outputBytes = 0
        for (const stream of [nextGuest.stdout, nextGuest.stderr]) stream.on('data', chunk => {
          outputBytes += chunk.length
          if (outputBytes > 1024 * 1024) nextGuest.kill('SIGKILL')
        })
      }
      // Publish ownership before readiness so startup failure and shutdown can
      // reap a live child that never completes its parent-channel handshake.
      guest = nextGuest
      removeGuestFailureListener = watchChild(nextGuest, 'guest')
      guestGlobalTools = await waitForGuestReady(
        nextGuest,
        web === undefined ? PROFILE_NAME : WEB_PROFILE_NAME,
        Object.keys(guestEnv).sort(),
        liveTurn === undefined && web === undefined ? 10_000 : 45_000,
      )
      return nextGuest
    }
    guest = await spawnGuest()
    throwIfStartupFailed()

    const beginOperation = () => {
      if (closing) {
        throw new DeveloperLaunchError('supervisor:assembly-closing', 'the source assembly is closing')
      }
      if (operationActive) {
        throw new DeveloperLaunchError('supervisor:operation-already-active', 'the source assembly permits one active operation')
      }
      operationActive = true
    }
    const executeMemoryPut = async args => {
      if (web !== undefined) {
        throw new DeveloperLaunchError('supervisor:web-browser-only', 'the Web assembly accepts proposals through its browser ToolRuntime')
      }
      if (liveTurn !== undefined) {
        throw new DeveloperLaunchError('supervisor:guest-turn-only', 'this assembly runs one user turn, not a direct memory.put')
      }
      beginOperation()
      try {
        return await executeGuestRequest(guest, {
          type: GUEST_EXECUTE_TYPE,
          arguments: parseDeveloperMemoryPut(args),
        })
      } finally {
        operationActive = false
      }
    }
    const executeUserTurn = async prompt => {
      if (liveTurn === undefined) {
        throw new DeveloperLaunchError('supervisor:live-turn-not-enabled', 'this assembly does not mount the live-turn overlay')
      }
      beginOperation()
      try {
        return await executeGuestRequest(guest, {
          type: GUEST_TURN_TYPE,
          prompt: parseDeveloperLiveTurn({ schema: LIVE_TURN_SCHEMA, prompt }).prompt,
        })
      } finally {
        operationActive = false
      }
    }
    const restartGuest = async () => {
      if (web === undefined) {
        throw new DeveloperLaunchError('supervisor:web-not-enabled', 'only the Web assembly supports guest restart')
      }
      if (closing) {
        throw new DeveloperLaunchError('supervisor:assembly-closing', 'the source assembly is closing')
      }
      if (operationActive) {
        throw new DeveloperLaunchError('supervisor:operation-already-active', 'the source assembly has an active operation')
      }
      if (restartPromise !== undefined) {
        throw new DeveloperLaunchError('supervisor:guest-restart-active', 'the Web guest is already restarting')
      }
      // Keep the currently serving guest until the retained activation has
      // revalidated, then repeat the check immediately before its replacement
      // executes to close changes during teardown.
      assertRetainedActivation()
      const occurrence = (async () => {
        removeGuestFailureListener?.()
        await stopChild(guest, 'guest')
        if (closing) {
          throw new DeveloperLaunchError('supervisor:assembly-closing', 'the source assembly is closing')
        }
        guest = await spawnGuest()
        return guest.pid
      })()
      restartPromise = occurrence
      try {
        return await occurrence
      } finally {
        if (restartPromise === occurrence) restartPromise = undefined
      }
    }
    published = true
    return Object.freeze({
      activationDigest: expectedActivationDigest,
      activationStatement,
      artifact,
      broker,
      close,
      executeMemoryPut,
      executeUserTurn,
      failure,
      get guest() { return guest },
      /** Global tool names the current guest reported; agent-session tools are not here. */
      get guestGlobalTools() { return guestGlobalTools },
      issuer,
      observationClass: confinement === undefined ? DEVELOPER_OBSERVATION_CLASS : CONFINED_OBSERVATION_CLASS,
      paths: Object.freeze({ ...paths }),
      restartGuest,
    })
  } catch (error) {
    closing = true
    for (const remove of removeFailureListeners.splice(0)) remove()
    await Promise.allSettled([
      stopChild(guest, 'guest'),
      stopChild(broker, 'broker'),
      stopChild(issuer, 'issuer'),
    ])
    throw error
  }

  function watchChild(child, label) {
    const onError = (error) => failAssembly(new DeveloperLaunchError(
      `supervisor:${label}-spawn-error`,
      error instanceof Error ? error.message : String(error),
    ))
    const onExit = (code, signal) => {
      if (closing) return
      const failureError = new DeveloperLaunchError(
        `supervisor:${label}-exited`,
        `code ${code ?? 'null'} signal ${signal ?? 'null'}`,
      )
      failAssembly(failureError)
    }
    child.once('error', onError)
    child.once('exit', onExit)
    const remove = () => {
      child.removeListener('error', onError)
      child.removeListener('exit', onExit)
    }
    removeFailureListeners.push(remove)
    return remove
  }
}

/**
 * Refuse a home-level patch layer inside the activation home.
 *
 * `dsh` composes [bundle, staged profile, HOME LAYER, overlays], so a
 * `cordis.patch.yml` beside the staged profile outranks it and can insert
 * rows the activation never measured. A per-launch activation home could not
 * carry one; a durable one can, and it is a sibling of the staging roots the
 * parent clears, so it survives re-staging. The activation names the staged
 * composition, so an unmeasured layer above it must stop the launch rather
 * than compose.
 * @param {string} activationHome - the DSH home this launch will serve.
 * @throws {DeveloperLaunchError} when a home composition layer is present.
 */
function assertNoHomeCompositionLayer(activationHome) {
  const homePatch = join(activationHome, 'cordis.patch.yml')
  try {
    lstatSync(homePatch)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw new DeveloperLaunchError('supervisor:home-composition-layer-unobservable', String(error?.code ?? error))
  }
  throw new DeveloperLaunchError('supervisor:home-composition-layer-present', homePatch)
}

/**
 * Remove one socket inode only when nothing is listening on it.
 *
 * A stable route outlives the process that bound it, so a crashed assembly
 * leaves an inode that would block the next launch. A RUNNING assembly leaves
 * the same inode with a listener behind it, and unlinking that one would let a
 * second launch destroy the first assembly's endpoints before the broker could
 * refuse an occupied socket. The two are distinguished by connecting.
 * @param {string} socketPath - endpoint on the stable route.
 * @throws {DeveloperLaunchError} when another assembly is listening there.
 */
function removeDeadEndpoint(socketPath) {
  let state
  try {
    state = lstatSync(socketPath)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw new DeveloperLaunchError('supervisor:route-endpoint-unobservable', String(error?.code ?? error))
  }
  if (!state.isSocket()) {
    throw new DeveloperLaunchError('supervisor:route-endpoint-not-a-socket', socketPath)
  }
  const probe = spawnSync(process.execPath, ['-e', `
    const { connect } = require('node:net')
    const s = connect(process.argv[1])
    s.once('connect', () => { s.destroy(); process.exit(0) })
    s.once('error', () => process.exit(3))
  `, socketPath], { timeout: 2000, encoding: 'utf8' })
  if (probe.status === 0) {
    throw new DeveloperLaunchError('supervisor:route-endpoint-occupied', socketPath)
  }
  rmSync(socketPath, { force: true })
}

/**
 * Resolve the activation epoch for this launch.
 *
 * An ephemeral launch activates at the moment it is measured. A durable
 * deployment activates once: the broker binds its state directory to one
 * activation digest and refuses a different one, so a per-launch clock reading
 * would make every relaunch a different activation and lock the parent out of
 * the state its own previous launch wrote. The epoch is therefore recorded
 * beside that state on first activation and reused afterwards. Every other
 * member of the statement is still measured per launch, so a changed
 * composition, module, key, or policy still produces a different digest and is
 * still refused.
 * @param {string | undefined} dataDir - parent-owned durable root, when present.
 * @param {boolean} [existingOnly] - refuse a missing epoch without creating one.
 * @returns {number} whole-second activation epoch.
 */
function activationEpoch(dataDir, existingOnly = false) {
  const now = Math.floor(Date.now() / 1000)
  if (dataDir === undefined) return now
  const epochFile = join(dataDir, 'activation-epoch')
  try {
    // Number.parseInt stops at the first non-digit, so it reads "12 34" as 12.
    // This file is a durable input to the activation digest: it is accepted
    // only when its whole content is one positive decimal integer.
    const recorded = readFileSync(epochFile, 'utf8').trim()
    if (!/^[1-9][0-9]{0,14}$/u.test(recorded)) {
      throw new DeveloperLaunchError('supervisor:activation-epoch-malformed', epochFile)
    }
    return Number.parseInt(recorded, 10)
  } catch (error) {
    if (error instanceof DeveloperLaunchError) throw error
    if (error?.code !== 'ENOENT') {
      throw new DeveloperLaunchError('supervisor:activation-epoch-unreadable', String(error?.code ?? error))
    }
  }
  if (existingOnly) throw new DeveloperLaunchError('supervisor:activation-epoch-absent', epochFile)
  writeFileSync(epochFile, `${String(now)}\n`, { mode: 0o600, flag: 'wx' })
  return now
}

/**
 * Measure a reconnectable Web target using the launcher's profile writer and statement builder.
 * Only the caller's empty staging directory is written; retained data and sockets are untouched.
 * A selected Capsule requires existing private capsule storage and explicit workspace aliases.
 * @param {import('./developer-launch.mjs').WebUpgradePreparation} options - existing deployment and selected owner-review configuration.
 * @returns {import('../activation/statement.mjs').ActivationStatementV1} target for attended upgrade, not permission to launch.
 */
export function prepareWebUpgradeStatement(options) {
  const dataDir = requireAbsoluteDataDir(options.dataDir)
  if (realpathSync(dataDir) !== dataDir) throw new DeveloperLaunchError('supervisor:data-dir-invalid', 'canonical data directory required')
  assertPrivateStagingDirectory(dataDir)
  assertPrivateStagingDirectory(options.stagingDir)
  if (realpathSync(options.stagingDir) !== options.stagingDir || readdirSync(options.stagingDir).length !== 0
    || options.stagingDir === dataDir || options.stagingDir.startsWith(`${dataDir}/`)) {
    throw new DeveloperLaunchError('supervisor:staging-root-unavailable', 'empty external staging directory required')
  }
  if (!/^[0-9a-f]{64}$/u.test(options.reviewConfigurationDigest)) {
    throw new DeveloperLaunchError('supervisor:review-configuration-invalid', 'owner-review digest required')
  }
  const web = readDeveloperWeb(options.web)
  const webOperatorHome = readWebOperatorHome(options.webOperatorHome, web)
  const workspaceRoots = options.workspaceRoots === undefined ? undefined
    : readDeveloperWorkspaceRoots(options.workspaceRoots, [options.stagingDir, dataDir])
  const webCapsule = options.webCapsule === undefined ? undefined
    : parseWebCapsuleConfig({ domain: WEB_CAPSULE_DOMAIN, ...options.webCapsule })
  let capsuleRoot
  if (webCapsule !== undefined) {
    if (workspaceRoots === undefined || Object.keys(workspaceRoots).length === 0) {
      throw new DeveloperLaunchError('supervisor:web-capsule-config-invalid', 'Capsule requires operator workspace aliases')
    }
    capsuleRoot = join(dataDir, 'capsules')
    assertPrivateStagingDirectory(capsuleRoot)
    if (realpathSync(capsuleRoot) !== capsuleRoot) {
      throw new DeveloperLaunchError('supervisor:staging-root-unavailable', 'canonical capsule directory required')
    }
  }
  const projection = readDeveloperWebAumlok(options.webAumlokProjection, options.rootControlState, web)
  const policy = readDeveloperKiraRecallPolicy({ subject: projection.projection.subject, privacy: ['private'] })
  const authority = readDeveloperDynamicSubjectAuthority(options.selectSubjectAuthority,
    options.subjectAuthorityExpectation, policy, projection)
  if (authority === undefined) throw new DeveloperLaunchError('supervisor:web-subject-authority-unavailable', 'v5 authority required')
  const stateDir = join(dataDir, 'broker-state')
  assertPrivateStagingDirectory(stateDir)
  // Refuse missing identity before invoking the shared load-or-provision reader.
  lstatSync(join(stateDir, 'keys', 'broker.json'))
  const identity = provisionBrokerIdentity(stateDir)
  const epoch = activationEpoch(dataDir, true)
  assertNoHomeCompositionLayer(join(dataDir, 'dsh-home'))
  const stagedProfile = stageWebActivationProfile(options.stagingDir,
    join(durableRouteDir(dataDir), 'broker.sock'), projection.projection.subject, web.port, join(dataDir, 'dsh-home'),
    webCapsule === undefined ? undefined : {
      ...webCapsule, capsuleRoot, workspaceAliases: workspaceRoots, receiptPublicKeyPem: identity.brokerPublicKeyPem,
    }, webOperatorHome)
  return buildSourceActivationStatement({
    stagedManifestPath: stagedProfile.manifestPath, stagedPatchPath: stagedProfile.patchPath, stagedProfile,
    rendererId: options.rendererId, reviewConfigurationDigest: options.reviewConfigurationDigest,
    issuerId: receiptKeyIdForPublicKey(options.rootPublicKeyPem), brokerId: identity.receiptKeyId, epoch, web,
    webAumlokProjection: projection.projection, kiraRecallPolicy: policy, workspaceRoots,
    subjectAuthorityExpectation: authority.subjectAuthorityExpectation,
  })
}

/** Validate an explicitly selected native CLI home; no credential files are read here. */
function readWebOperatorHome(value, web) {
  if (value === undefined) return undefined
  if (web === undefined || typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value) {
    throw new DeveloperLaunchError('supervisor:web-operator-home-invalid', 'operator coding requires Web and a canonical absolute home')
  }
  let state
  try { state = lstatSync(value) }
  catch (cause) {
    throw new DeveloperLaunchError('supervisor:web-operator-home-invalid', `operator home cannot be inspected: ${String(cause?.code ?? cause)}`)
  }
  if (!state.isDirectory() || state.isSymbolicLink() || realpathSync(value) !== value
    || state.uid !== process.geteuid() || (state.mode & 0o022) !== 0) {
    throw new DeveloperLaunchError('supervisor:web-operator-home-invalid', 'operator home must be an owned directory without group or other write access')
  }
  return value
}

/**
 * Locate the stable socket route for one durable deployment.
 *
 * The broker route enters the staged composition and therefore the activation
 * digest, so it must not read `TMPDIR`: a parent started with a different
 * value would measure a different activation and be refused entry to the state
 * its own previous launch wrote. The base is a fixed platform location instead
 * — the per-user runtime directory where the platform defines one, and the
 * system temporary directory by its literal path otherwise. The leaf is a
 * digest of the canonical data root, so one deployment always names one route
 * and two deployments never share one.
 * @param {string} durable - canonical durable data root.
 * @returns {string} absolute route directory for this deployment.
 */
function durableRouteDir(durable) {
  const euid = process.geteuid?.() ?? 0
  const perUserRuntime = `/run/user/${String(euid)}`
  const base = process.platform === 'linux' && existsSync(perUserRuntime)
    ? join(perUserRuntime, 'aukora')
    : join('/tmp', `aukora-${String(euid)}`)
  return join(base, sha256(Buffer.from(durable, 'utf8')).slice(0, 16))
}

/**
 * Refuse a durable data root that is not an absolute, plainly spelled path.
 *
 * The launcher only ever receives this from a parent that already resolved it;
 * this check keeps a relative or control-bearing spelling from reaching the
 * directory reuse, where it would be created rather than refused.
 * @param {unknown} input - caller-supplied durable root.
 * @returns {string} the same path, once it is an absolute plain spelling.
 */
function requireAbsoluteDataDir(input) {
  if (typeof input !== 'string' || !isAbsolute(input) || resolve(input) !== input || !PLAIN_PATH.test(input)) {
    throw new DeveloperLaunchError('supervisor:data-dir-invalid', String(input))
  }
  return input
}

/**
 * Reuse one parent-owned durable directory, refusing anything this uid does
 * not privately own. Unlike the exclusive runtime tree this path survives the
 * launch, so exclusivity cannot come from creation and is measured instead.
 * @param {string} directory - absolute path inside the data root.
 * @returns {string} the same path, once it is a private directory of this uid.
 */
function reuseDurableDirectory(directory) {
  try {
    // Create only when absent, then inspect before changing anything: chmod
    // follows a symlink and lstat does not, so mutating first would rewrite the
    // mode of the very target this refuses.
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 })
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
    const state = lstatSync(directory)
    if (!state.isDirectory()
      || state.isSymbolicLink()
      || state.uid !== process.geteuid?.()
      || (state.mode & 0o777) !== 0o700) {
      throw new DeveloperLaunchError('supervisor:data-dir-unavailable', directory)
    }
  } catch (error) {
    if (error instanceof DeveloperLaunchError) throw error
    throw new DeveloperLaunchError('supervisor:data-dir-unavailable', String(error?.code ?? error))
  }
  return directory
}

/**
 * Create one exclusive private runtime tree and return its fixed paths.
 *
 * The runtime tree is always new: it carries this launch's sockets and staged
 * composition, which must not be inherited. When `dataDir` is present the
 * three stores that outlive a launch — the guest home, the DSH home holding
 * sessions and settings, and the broker state holding KIRA objects, receipts,
 * Aura, and authority evidence — are placed under it instead. The activation
 * statement digests named staged files rather than walking a tree, so state
 * accumulating beside the staged profile does not enter the measurement.
 * @param {string} runtimeDir - new private directory for this launch.
 * @param {string} [dataDir] - parent-owned durable root, already validated.
 * @returns {Readonly<{activationHome: string, brokerSocket: string, guestHome: string, issuerSocket: string, runtimeDir: string, stateDir: string}>} fixed paths.
 */
function prepareRuntime(runtimeDir, dataDir) {
  try {
    mkdirSync(runtimeDir, { mode: 0o700 })
  } catch (error) {
    throw new DeveloperLaunchError('supervisor:runtime-dir-unavailable', String(error?.code ?? error))
  }
  chmodSync(runtimeDir, 0o700)
  const durable = dataDir === undefined ? undefined : reuseDurableDirectory(dataDir)
  const activationHome = durable === undefined
    ? join(runtimeDir, 'activation')
    : reuseDurableDirectory(join(durable, 'dsh-home'))
  const guestHome = durable === undefined
    ? join(runtimeDir, 'guest-home')
    : reuseDurableDirectory(join(durable, 'guest-home'))
  // The broker's state directory is created by the parent, before the broker
  // exists, so the parent can provision the broker identity and bind the
  // activation while it is still the only principal that owns this path.
  const stateDir = durable === undefined
    ? join(runtimeDir, 'broker-state')
    : reuseDurableDirectory(join(durable, 'broker-state'))
  for (const directory of [activationHome, guestHome, stateDir]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    chmodSync(directory, 0o700)
  }
  assertNoHomeCompositionLayer(activationHome)
  // The broker binds its activation digest into its state directory and refuses
  // a different one. The staged composition carries the broker socket path, so
  // a durable deployment needs a stable route: a per-launch socket would change
  // the composition, change the activation, and lock the parent out of the
  // state its own previous launch wrote. Stale endpoints are removed because a
  // socket file outlives the process that bound it.
  // The route is derived from the durable root rather than placed inside it:
  // a Unix socket path is capped at 103 bytes and a data root chosen by an
  // operator (or a test temp directory) can already spend most of that.
  const routeDir = durable === undefined ? runtimeDir : reuseDurableDirectory(durableRouteDir(durable))
  const brokerSocket = join(routeDir, 'broker.sock')
  const issuerSocket = join(routeDir, 'issuer.sock')
  if (durable !== undefined) {
    for (const socketPath of [brokerSocket, issuerSocket]) removeDeadEndpoint(socketPath)
  }
  for (const socketPath of [brokerSocket, issuerSocket]) {
    if (Buffer.byteLength(socketPath, 'utf8') > MAX_UNIX_SOCKET_PATH_BYTES) {
      throw new DeveloperLaunchError('supervisor:socket-path-too-long', `socket path exceeds ${String(MAX_UNIX_SOCKET_PATH_BYTES)} UTF-8 bytes`)
    }
  }
  return Object.freeze({
    activationHome,
    brokerSocket,
    guestHome,
    issuerSocket,
    runtimeDir,
    stateDir,
  })
}

/**
 * Require one staging directory to be a private directory owned by this uid.
 *
 * The check always precedes recursive removal. `rmSync()` on a child path can
 * traverse a symlinked ancestor, while changing permissions before `lstatSync`
 * would mutate the target the launcher must refuse.
 * @param {string} directory - staging parent or removable staging root.
 * @throws {DeveloperLaunchError} when the path is not an owned non-link directory.
 */
function assertPrivateStagingDirectory(directory) {
  let state
  try {
    state = lstatSync(directory)
  } catch (error) {
    throw new DeveloperLaunchError('supervisor:staging-root-unavailable', String(error?.code ?? error))
  }
  if (!state.isDirectory()
    || state.isSymbolicLink()
    || state.uid !== process.geteuid?.()
    || (state.mode & 0o777) !== 0o700) {
    throw new DeveloperLaunchError('supervisor:staging-root-unavailable', directory)
  }
}

/**
 * Create one staging parent when absent, then validate it without following a
 * link. The activation home already exists, so recursive creation is neither
 * required nor permitted here.
 * @param {string} directory - direct child of the validated activation home.
 */
function prepareStagingParent(directory) {
  try {
    mkdirSync(directory, { mode: 0o700 })
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      throw new DeveloperLaunchError('supervisor:staging-root-unavailable', String(error?.code ?? error))
    }
  }
  assertPrivateStagingDirectory(directory)
}

/**
 * Remove one staging root this parent owns, so the exclusive writes that
 * follow still prove this launch produced the staged bytes.
 *
 * A durable DSH home carries the previous launch's staged composition. Without
 * this the exclusive write refuses `EEXIST`; adopting the existing file
 * instead would let a pre-planted composition enter the activation. Both the
 * direct parent and the removable root are inspected before recursive removal.
 * @param {string} directory - staging root under the activation home.
 */
function clearStagingRoot(directory) {
  prepareStagingParent(dirname(directory))
  try {
    lstatSync(directory)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw new DeveloperLaunchError('supervisor:staging-root-unavailable', String(error?.code ?? error))
  }
  assertPrivateStagingDirectory(directory)
  try {
    rmSync(directory, { recursive: true })
  } catch (error) {
    throw new DeveloperLaunchError('supervisor:staging-root-unavailable', String(error?.code ?? error))
  }
}

/** Copy the frozen four-row profile and replace its one literal broker route. */
function stageActivationProfile(activationHome, brokerSocket) {
  const profileDir = join(activationHome, 'profiles', PROFILE_NAME)
  clearStagingRoot(profileDir)
  mkdirSync(profileDir, { mode: 0o700 })
  const manifest = readFileSync(PROFILE_MANIFEST, 'utf8')
  validateSourceProfileManifest(manifest)
  const sourcePatch = readFileSync(PROFILE_PATCH, 'utf8')
  validateSourceProfilePatch(sourcePatch)
  const patch = sourcePatch.replace(BROKER_LITERAL, `brokerSocket: ${JSON.stringify(brokerSocket)}`)
  const manifestPath = join(profileDir, 'package.json')
  const patchPath = join(profileDir, 'cordis.patch.yml')
  writeFileSync(manifestPath, manifest, { mode: 0o600, flag: 'wx' })
  writeFileSync(patchPath, patch, { mode: 0o600, flag: 'wx' })
  return Object.freeze({
    manifestPath,
    manifestSha256: sha256(Buffer.from(manifest)),
    patchPath,
    patchSha256: sha256(Buffer.from(patch)),
  })
}

/** Prepare the same profile through its built boot before the restricted guest exists. */
function prepareConfinedProfile(paths) {
  const prepared = spawnSync(process.execPath, ['--', GUEST_ENTRY, '--prepare-profile'], {
    cwd: ROOT,
    env: { DSH_HOME: paths.activationHome, DSH_TELEMETRY_DISABLED: '1', HOME: paths.guestHome, LANG: 'C' },
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 45_000, maxBuffer: 128 * 1024,
  })
  if (prepared.status !== 0 || prepared.signal !== null || prepared.error !== undefined) {
    throw new DeveloperLaunchError('supervisor:confined-profile-preparation-failed',
      `run pnpm run build:lib:host first: ${String(prepared.error?.message ?? prepared.stderr).slice(0, 2048)}`)
  }
}

/**
 * Count Loader executable-expression leaves per row id, using the Loader's
 * own YAML schema and JsExpr discriminator rather than a hand-rolled scan.
 * @param {string} text - one cordis.patch.yml file's bytes.
 * @returns {Record<string, number>} leaf count keyed by row id.
 */
function censusExecutableConfig(text) {
  const parsed = loadYaml(text, { schema: entryListSchema })
  const rows = {}
  const walk = (value, rowId) => {
    if (isJsExpr(value)) {
      rows[rowId] = (rows[rowId] ?? 0) + 1
      return
    }
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, rowId)
      return
    }
    if (value !== null && typeof value === 'object') {
      for (const entry of Object.values(value)) walk(entry, rowId)
    }
  }
  const visit = (entries) => {
    for (const entry of entries) {
      if (entry.insert) {
        visit(entry.insert)
        continue
      }
      if (typeof entry.id !== 'string') continue
      walk(entry.disabled, entry.id)
      walk(entry.config, entry.id)
    }
  }
  visit(Array.isArray(parsed) ? parsed : [])
  return rows
}

/**
 * Collect every top-level row id one patch file names, including inside
 * `insert` blocks, for a disjointness check against the parent's own
 * override rows.
 * @param {string} text - one cordis.patch.yml file's bytes.
 * @returns {Set<string>} every named row id.
 */
function patchRowIds(text) {
  const ids = new Set()
  const visit = (entries) => {
    for (const entry of entries) {
      if (entry.insert) {
        visit(entry.insert)
        continue
      }
      if (typeof entry.id === 'string') ids.add(entry.id)
    }
  }
  const parsed = loadYaml(text, { schema: entryListSchema })
  visit(Array.isArray(parsed) ? parsed : [])
  return ids
}

/**
 * Refuse launch unless the two selected Web bundles carry exactly the frozen
 * executable-expression census. The parent-staged literal overrides below are
 * proven to cover that exact set; a changed bundle can only be trusted after
 * the override set is re-verified against it, so launch refuses by name
 * rather than silently staging overrides that no longer cover every leaf.
 * @throws {DeveloperLaunchError} when the measured census diverges.
 */
function assertExpectedWebExecutableCensus() {
  const base = censusExecutableConfig(readFileSync(BUNDLE_BASE_PATCH, 'utf8'))
  const webApp = censusExecutableConfig(readFileSync(BUNDLE_WEB_APP_PATCH, 'utf8'))
  if (Object.keys(base).some((id) => id in webApp)) {
    throw new DeveloperLaunchError(
      'supervisor:web-bundle-census-changed',
      'a row now carries executable expressions in both selected bundles',
    )
  }
  const observed = { ...base, ...webApp }
  if (canonicalJSON(observed) !== canonicalJSON(EXPECTED_WEB_EXECUTABLE_CENSUS)) {
    throw new DeveloperLaunchError(
      'supervisor:web-bundle-census-changed',
      `measured ${canonicalJSON(observed)} expected ${canonicalJSON(EXPECTED_WEB_EXECUTABLE_CENSUS)}`,
    )
  }
}

/**
 * Build the parent-staged literal replacement for every row the frozen
 * census names, derived only from already-validated parent inputs: the
 * durable activation home, the repository workspace root the guest is
 * spawned in, the selected loopback port, and fixed test/product policy.
 * Each row restates its WHOLE config object where any leaf of that config is
 * executable, matching patch semantics that replace a row's config wholesale
 * rather than merging into it.
 * @param {string} activationHome - this launch's DSH home.
 * @param {number} port - the selected loopback port.
 * @returns {readonly Record<string, unknown>[]} one literal patch entry per affected row.
 */
function webLiteralExecutableOverrides(activationHome, port) {
  const isWindows = process.platform === 'win32'
  return Object.freeze([
    { id: 'session-persistence-jsonl', config: { root: join(activationHome, 'sessions') } },
    {
      id: 'session-telemetry-otel',
      disabled: true,
      config: {
        mode: 'DISABLED',
        shutdownTimeoutMillis: 3000,
        exporter: {
          url: 'https://harness-telemetry.deepseeksvc.com/v1/logs',
          compression: 'gzip',
          timeoutMillis: 1000,
        },
        processor: {
          scheduledDelayMillis: 10000,
          maxQueueSize: 2048,
          maxExportBatchSize: 2048,
          exportTimeoutMillis: 1500,
        },
      },
    },
    { id: 'sandbox-policy', config: { mode: 'workspace-write', workspaceRoot: ROOT } },
    { id: 'bash-sandbox', disabled: isWindows },
    { id: 'pwsh-sandbox', disabled: !isWindows },
    { id: 'approval', config: { policy: 'ask' } },
    { id: 'tool-bash', disabled: true },
    { id: 'tool-pwsh', disabled: true },
    { id: 'tools', config: { mode: 'native' } },
    { id: 'storage-json', config: { root: join(activationHome, 'storages') } },
    { id: 'webserver', config: { host: '127.0.0.1', port } },
    { id: 'web-runtime', config: { openBrowser: false, printUrl: true, surfaceContext: true, trustedHosts: [] } },
    { id: 'connection', config: { trustedHosts: [] } },
  ])
}

/**
 * Append literal patch rows to one staged patch file's text.
 *
 * Each row is emitted as one block-sequence item whose value is JSON, not
 * hand-formatted YAML: JSON is valid YAML and `JSON.stringify` cannot itself
 * emit a custom tag, so the appended bytes cannot carry an executable
 * expression regardless of what the literal values happen to contain.
 * @param {string} patchText - the staged patch's existing bytes.
 * @param {readonly Record<string, unknown>[]} overrides - literal patch rows to append.
 * @returns {string} the combined patch text.
 * @throws {DeveloperLaunchError} if the generated block is not literal.
 */
function appendLiteralOverrides(patchText, overrides) {
  const block = overrides.map((entry) => `- ${JSON.stringify(entry)}`).join('\n')
  if (block.includes('!!js')) {
    throw new DeveloperLaunchError('supervisor:web-override-unexpected', 'generated override block is not literal')
  }
  return `${patchText}\n${block}\n`
}

/**
 * Stage the reviewed Web profile: replace its broker route and append one
 * literal override row per bundle row that ships an executable expression.
 *
 * The staged patch is the composition the activation statement measures, so
 * every appended value is a literal scalar derived from this function's own
 * validated inputs. The guest's environment is a fixed allow-list that never
 * carries `DSH_TOOLS_MODE`, `DSH_PERMISSION_MODE`, or the telemetry variables,
 * and it pins `DSH_HOME` and the guest's working directory, so each overridden
 * expression has exactly one value under this launch and that value is written
 * out instead of the expression.
 * @param {string} activationHome - this launch's activation home; the staged
 *   profile, sessions, and storages all resolve beneath it.
 * @param {string} brokerSocket - broker route replacing the profile's literal placeholder.
 * @param {string} aumlokSubject - AUMLOK subject bound into the staged preset.
 * @param {number} port - loopback port the Web surface binds, written into the
 *   webserver override.
 * @param {string} [storageHome] - retained session/storage home when measuring in an external staging directory.
 * @returns {Readonly<Record<string, string>>} staged file paths with the SHA-256
 *   of the exact bytes written, for the activation statement to measure.
 * @throws {DeveloperLaunchError} `supervisor:web-profile-unexpected` when the
 *   checked-in profile is not the reviewed one; `supervisor:web-bundle-census-changed`
 *   when a bundle's executable-expression census moved; `supervisor:web-override-unexpected`
 *   when the profile already owns an overridden row id or the generated block
 *   would carry an executable tag.
 */
function stageWebActivationProfile(activationHome, brokerSocket, aumlokSubject, port, storageHome = activationHome, capsule, operatorHome) {
  const profileDir = join(activationHome, 'profiles', WEB_PROFILE_NAME)
  clearStagingRoot(profileDir)
  mkdirSync(profileDir, { mode: 0o700 })
  const manifest = readFileSync(WEB_PROFILE_MANIFEST, 'utf8')
  let parsedManifest
  try {
    parsedManifest = JSON.parse(manifest)
  } catch {
    throw new DeveloperLaunchError('supervisor:web-profile-unexpected', 'profile manifest must be JSON')
  }
  const profile = parsedManifest?.dsh?.profile
  if (parsedManifest?.name !== `dsh-profile-${WEB_PROFILE_NAME}`
    || parsedManifest.private !== true
    || !isExactObject(parsedManifest.dsh, ['profile'])
    || !isExactObject(profile, ['bundles'])
    || !Array.isArray(profile.bundles)
    || profile.bundles.length !== 2
    || profile.bundles[0] !== '@deepseek-ai/dsh-base'
    || profile.bundles[1] !== '@deepseek-ai/dsh-web-app') {
    throw new DeveloperLaunchError(
      'supervisor:web-profile-unexpected',
      'profile must select exactly the base and Web bundles in that order',
    )
  }
  const sourcePatch = readFileSync(WEB_PROFILE_PATCH, 'utf8')
  if (Buffer.byteLength(sourcePatch, 'utf8') > MAX_CONFIG_BYTES
    || sourcePatch.includes('!!js')
    || sourcePatch.split(BROKER_LITERAL).length - 1 !== WEB_BROKER_ROUTE_COUNT) {
    throw new DeveloperLaunchError(
      'supervisor:web-profile-unexpected',
      `profile patch must be bounded, literal, and contain ${WEB_BROKER_ROUTE_COUNT} broker routes`,
    )
  }
  // The frozen census is re-verified on every Web launch, not only when the
  // bundles happen to change: it is what proves the override rows below still
  // cover every surviving Loader expression in the composition this launch
  // will actually mount.
  assertExpectedWebExecutableCensus()
  const overrides = webLiteralExecutableOverrides(storageHome, port)
  const sourceRowIds = patchRowIds(sourcePatch)
  const collidingRow = overrides.find((entry) => sourceRowIds.has(String(entry.id)))
  if (collidingRow !== undefined) {
    throw new DeveloperLaunchError(
      'supervisor:web-override-unexpected',
      `the checked-in profile patch already owns row ${String(collidingRow.id)}`,
    )
  }
  const patch = appendLiteralOverrides(
    sourcePatch.replaceAll(BROKER_LITERAL, `brokerSocket: ${JSON.stringify(brokerSocket)}`),
    overrides,
  )
  const manifestPath = join(profileDir, 'package.json')
  const patchPath = join(profileDir, 'cordis.patch.yml')
  const presetRoot = join(activationHome, 'agent-presets')
  const presetDir = join(presetRoot, 'aukora')
  const presetManifest = readFileSync(WEB_PRESET_MANIFEST, 'utf8')
  const sourcePresetComposition = readFileSync(WEB_PRESET_COMPOSITION, 'utf8')
  if (sourcePresetComposition.split(WEB_AUMLOK_SUBJECT_LITERAL).length - 1 !== 1) {
    throw new DeveloperLaunchError(
      'supervisor:web-preset-unexpected',
      'AUKORA preset must contain one subject projection point',
    )
  }
  let presetComposition = sourcePresetComposition.replace(
    WEB_AUMLOK_SUBJECT_LITERAL,
    aumlokSubject,
  )
  if (Buffer.byteLength(presetManifest, 'utf8') > MAX_CONFIG_BYTES
    || Buffer.byteLength(presetComposition, 'utf8') > MAX_CONFIG_BYTES
    || presetManifest.includes('!!js')
    || presetComposition.includes('!!js')) {
    throw new DeveloperLaunchError(
      'supervisor:web-preset-unexpected',
      'AUKORA preset members must be bounded literal YAML',
    )
  }
  clearStagingRoot(presetDir)
  mkdirSync(presetDir, { mode: 0o700 })
  const presetManifestPath = join(presetDir, 'preset.yml')
  const presetCompositionPath = join(presetDir, 'agent.cordis.yml')
  writeFileSync(manifestPath, manifest, { mode: 0o600, flag: 'wx' })
  writeFileSync(patchPath, patch, { mode: 0o600, flag: 'wx' })
  writeFileSync(presetManifestPath, presetManifest, { mode: 0o600, flag: 'wx' })
  const capsuleMembers = {}
  if (capsule !== undefined) {
    const template = loadYaml(readFileSync(WEB_CAPSULE_OVERLAY, 'utf8'))
    if (!Array.isArray(template) || template.length !== 1 || template[0]?.insert?.length !== 1
      || template[0].insert[0].name !== '@deepseek-ai/dsh-capsule' || template[0].insert[0].id !== 'helix-capsule') {
      throw new DeveloperLaunchError('supervisor:web-capsule-template-invalid', 'expected one Capsule insert')
    }
    // Replace every template configuration field; no placeholder or executable YAML survives.
    // receiptPublicKeyPem arrives provisioned from the parent-owned broker
    // identity, never from a broker reply.
    const overlay = [{ insert: [{ id: 'helix-capsule', name: '@deepseek-ai/dsh-capsule', config: {
      capsuleRoot: capsule.capsuleRoot, worker: capsule.worker, protectedChecks: capsule.protectedChecks,
      workerPreset: 'aukora-capsule-worker',
      broker: { socketPath: brokerSocket, workspaceAliases: capsule.workspaceAliases, receiptPublicKeyPem: capsule.receiptPublicKeyPem },
    } }] }]
    const capsulePatchPath = join(profileDir, 'helix-capsule.overlay.yml')
    writeFileSync(capsulePatchPath, `${JSON.stringify(overlay)}\n`, { mode: 0o600, flag: 'wx' })
    const workerPresetDir = join(presetRoot, 'aukora-capsule-worker')
    clearStagingRoot(workerPresetDir)
    mkdirSync(workerPresetDir, { mode: 0o700 })
    const workerPresetManifestPath = join(workerPresetDir, 'preset.yml')
    const workerPresetCompositionPath = join(workerPresetDir, 'agent.cordis.yml')
    // A candidate session needs no in-process coding tools: its native CLI is confined separately.
    writeFileSync(workerPresetManifestPath, 'name: AUKORA Capsule worker\ndescription: Task-owned native worker session.\n', { mode: 0o600, flag: 'wx' })
    writeFileSync(workerPresetCompositionPath, presetComposition, { mode: 0o600, flag: 'wx' })
    const preset = loadYaml(presetComposition)
    const kira = preset.find(row => row.id === 'kira')?.config?.find(row => row.id === 'kira-routes')
    const inheritedTools = kira?.config?.additionalInheritedTools
    if (kira?.config?.restrictGlobalToolsToMemoryPut !== true
      || (inheritedTools !== undefined && (!Array.isArray(inheritedTools)
        || inheritedTools.some(name => typeof name !== 'string' || name.length === 0)))) {
      throw new DeveloperLaunchError('supervisor:web-capsule-preset-invalid', 'the inherited mask and explicit tool names must be valid')
    }
    kira.config.additionalInheritedTools = [...new Set([...(inheritedTools === undefined ? [] : inheritedTools), 'capsule'])]
    const persona = preset.find(row => row.id === 'persona')
    persona.config.text += '\nUse capsule workspaces to discover operator-registered aliases, then inspect with workspace and an optional path for bounded source reads. Admit explicit files, dispatch the configured coding worker, collect, inspect with taskId to read the candidate, freeze, check and offer. Never combine workspace and taskId inspection. Native worker dispatch is not a brokered effect or a model-spend grant. Only the operator submits /capsule-promote taskId for broker review; no tool action approves or applies a candidate.'
    presetComposition = `${JSON.stringify(preset)}\n`
    Object.assign(capsuleMembers, { capsulePatchPath, workerPresetManifestPath, workerPresetCompositionPath })
  }
  if (operatorHome !== undefined) {
    presetComposition = composeWebOperatorPreset({ aukoraPreset: presetComposition,
      standardPreset: readFileSync(WEB_STANDARD_PRESET, 'utf8'), platform: process.platform, operatorCoding: true })
  }
  writeFileSync(presetCompositionPath, presetComposition, { mode: 0o600, flag: 'wx' })
  const prepared = spawnSync(process.execPath, ['--import', 'tsx/esm', WEB_GUEST_ENTRY, '--prepare'], {
    cwd: ROOT,
    env: { DSH_HOME: activationHome, DSH_TELEMETRY_DISABLED: '1', HOME: activationHome, LANG: 'C.UTF-8' },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 45_000,
    maxBuffer: 128 * 1024,
  })
  if (prepared.status !== 0 || prepared.signal !== null || prepared.error !== undefined) {
    throw new DeveloperLaunchError('supervisor:web-profile-preparation-failed',
      `profile preparation failed: ${String(prepared.error?.message ?? prepared.stderr).slice(0, 2048)}`)
  }
  const rootConfigPath = join(profileDir, 'cordis.yml')
  if (operatorHome !== undefined) {
    const ids = []
    const visit = rows => {
      for (const row of rows) {
        if (row.disabled === true) continue
        if (typeof row.id === 'string') ids.push(row.id)
        if (Array.isArray(row.config)) visit(row.config)
      }
    }
    const layers = [
      loadYaml(readFileSync(BUNDLE_BASE_PATCH, 'utf8'), { schema: entryListSchema }),
      loadYaml(readFileSync(BUNDLE_WEB_APP_PATCH, 'utf8'), { schema: entryListSchema }),
      loadYaml(patch, { schema: entryListSchema }),
    ]
    visit(applyEntryPatches([], structuredClone(layers.flat()), message => {
      throw new DeveloperLaunchError('supervisor:web-operator-host-invalid', message)
    }))
    assertWebOperatorHost(ids, process.platform)
  }
  chmodSync(rootConfigPath, 0o444)
  return Object.freeze({
    manifestPath,
    manifestSha256: sha256(Buffer.from(manifest)),
    patchPath,
    patchSha256: sha256(Buffer.from(patch)),
    presetRoot,
    presetManifestPath,
    presetManifestSha256: sha256(Buffer.from(presetManifest)),
    presetCompositionPath,
    presetCompositionSha256: sha256(Buffer.from(presetComposition)),
    ...(operatorHome === undefined ? {} : { operatorHome }),
    ...capsuleMembers,
  })
}

/**
 * Require the fixed zero-bundle manifest, allowing only its optional AGPL license metadata.
 * @param {unknown} sourceManifest - Candidate UTF-8 package manifest text.
 * @returns {void}
 */
export function validateSourceProfileManifest(sourceManifest) {
  let parsedManifest
  try {
    if (typeof sourceManifest !== 'string') throw new TypeError('manifest must be text')
    parsedManifest = JSON.parse(sourceManifest)
  } catch {
    throw new DeveloperLaunchError('supervisor:source-profile-unexpected', 'profile manifest must be JSON')
  }
  const profile = parsedManifest?.dsh?.profile
  const hasLicense = typeof parsedManifest === 'object' && parsedManifest !== null
    && Object.hasOwn(parsedManifest, 'license')
  const fields = ['name', 'private', 'dependencies', 'dsh']
  if (hasLicense) fields.push('license')
  if (!isExactObject(parsedManifest, fields)
    || (hasLicense && parsedManifest.license !== 'AGPL-3.0-or-later')
    || parsedManifest.name !== `dsh-profile-${PROFILE_NAME}`
    || parsedManifest.private !== true
    || !isExactObject(parsedManifest.dependencies, [])
    || !isExactObject(parsedManifest.dsh, ['profile'])
    || !isExactObject(profile, ['bundles'])
    || !Array.isArray(profile.bundles)
    || profile.bundles.length !== 0) {
    throw new DeveloperLaunchError(
      'supervisor:source-profile-unexpected',
      'profile manifest must select exactly the empty bundle set and only optional AGPL-3.0-or-later license metadata',
    )
  }
}

/**
 * Require the exact reviewed source profile before substituting its broker route.
 * @param {unknown} sourcePatch - Candidate UTF-8 profile text.
 * @returns {void}
 */
export function validateSourceProfilePatch(sourcePatch) {
  if (typeof sourcePatch !== 'string'
    || sha256(Buffer.from(sourcePatch)) !== SOURCE_PROFILE_PATCH_SHA256) {
    throw new DeveloperLaunchError(
      'supervisor:source-profile-unexpected',
      'profile bytes do not match the reviewed zero-bundle four-row source',
    )
  }
  const occurrences = sourcePatch.split(BROKER_LITERAL).length - 1
  if (occurrences !== 1 || sourcePatch.includes('!!js')) {
    throw new DeveloperLaunchError('supervisor:source-profile-unexpected', 'profile must contain one literal broker route and no executable values')
  }
}

/**
 * Require the reviewed live-turn overlay, and the fixture overlay when selected.
 * @param {boolean} fixture - Whether the keyless fixture overlay is in this launch.
 * @returns {void}
 */
export function validateLiveTurnOverlays(fixture) {
  const overlay = readFileSync(LIVE_TURN_OVERLAY, 'utf8')
  if (sha256(Buffer.from(overlay)) !== SOURCE_LIVE_TURN_OVERLAY_SHA256 || overlay.includes('!!js')) {
    throw new DeveloperLaunchError(
      'supervisor:live-turn-overlay-unexpected',
      'live-turn overlay bytes do not match the reviewed parent-staged loop stack',
    )
  }
  if (!fixture) return
  const fixtureOverlay = readFileSync(LIVE_TURN_FIXTURE_OVERLAY, 'utf8')
  if (sha256(Buffer.from(fixtureOverlay)) !== SOURCE_LIVE_TURN_FIXTURE_OVERLAY_SHA256
    || fixtureOverlay.includes('!!js')) {
    throw new DeveloperLaunchError(
      'supervisor:live-turn-overlay-unexpected',
      'fixture overlay bytes do not match the reviewed keyless loop adapter',
    )
  }
}

/**
 * Measure one file this launcher selected, tolerating only ancestor links.
 *
 * A caller-chosen runtime directory routinely sits under a link — on macOS
 * both `/tmp` and `/var` resolve elsewhere — so the ancestry is canonicalized.
 * The member itself is still refused if it is a link, is not a regular file,
 * or is writable beyond its owner.
 *
 * @param {string} path - absolute path to an existing regular file.
 * @returns {string} lowercase SHA-256 of the member's bytes.
 */
function measureLaunchMember(path) {
  return measureClosureMember(path, { allowAncestorLinks: true })
}

/**
 * Build the one activation statement this launch will serve.
 *
 * The full static issuer/broker graph and the explicit source-launch anchors
 * selected here are named, including the source files for the parser and
 * measurement implementation. Changes to those selected bytes, the composition,
 * the proposal cell, the trusted renderer, the emission policy, or either
 * identity produce a different activation digest. Node built-ins, dynamically imported
 * modules, transitive package artifacts, and operating-system behavior remain
 * outside this source-inspected manifest.
 *
 * @param {object} inputs - parent-owned selections measured before any child starts.
 * @param {string} inputs.stagedManifestPath - staged profile manifest path.
 * @param {string} inputs.stagedPatchPath - staged profile patch path.
 * @param {{manifestSha256: string, patchSha256: string, presetManifestPath?: string, presetManifestSha256?: string, presetCompositionPath?: string, presetCompositionSha256?: string}} inputs.stagedProfile - staged composition digests and optional Web preset members.
 * @param {string} inputs.rendererId - SHA-256 identity of the selected parent renderer.
 * @param {string} [inputs.reviewConfigurationDigest] - pinned reconnectable owner route and public key.
 * @param {string} inputs.issuerId - issuer root identity digest.
 * @param {string} inputs.brokerId - broker receipt key identity.
 * @param {number} inputs.epoch - activation epoch in whole seconds.
 * @param {{fixture?: boolean}} [inputs.liveTurn] - Parent-staged loop overlay, when selected.
 * @param {{port: number}} [inputs.web] - Parent-staged loopback Web surface, when selected.
 * @param {object} [inputs.webAumlokProjection] - exact browser-safe active-control projection.
 * @param {{subject: string, privacy: readonly string[]}} [inputs.kiraRecallPolicy] -
 *   parent-owned KIRA recall policy selected for this activation.
 * @param {{subject: string, activeControlDigest: string, audience: string}} [inputs.subjectAuthorityExpectation] -
 *   proposal-specific identity and audience selected for this activation.
 * @returns {import('../activation/statement.d.mts').ActivationStatementV1} validated statement.
 */
export function buildSourceActivationStatement(inputs) {
  const liveTurn = inputs.liveTurn
  const web = inputs.web
  const sourceManifest = web === undefined ? PROFILE_MANIFEST : WEB_PROFILE_MANIFEST
  const sourcePatch = web === undefined ? PROFILE_PATCH : WEB_PROFILE_PATCH
  const composition = {
    sourceProfileManifestSha256: fileSha256(sourceManifest),
    sourceProfilePatchSha256: fileSha256(sourcePatch),
    stagedProfileManifestSha256: inputs.stagedProfile.manifestSha256,
    stagedProfilePatchSha256: inputs.stagedProfile.patchSha256,
  }
  if (inputs.guestConfinement !== undefined) composition.guestConfinement = inputs.guestConfinement
  if (web !== undefined) {
    if (inputs.stagedProfile.operatorHome !== undefined) composition.operatorHome = inputs.stagedProfile.operatorHome
    composition.sourcePresetManifestSha256 = fileSha256(WEB_PRESET_MANIFEST)
    composition.sourcePresetCompositionSha256 = fileSha256(WEB_PRESET_COMPOSITION)
    composition.stagedPresetManifestSha256 = inputs.stagedProfile.presetManifestSha256
    composition.stagedPresetCompositionSha256 = inputs.stagedProfile.presetCompositionSha256
    composition.aumlokProjectionSha256 = sha256(Buffer.from(
      serializeDeveloperAumlokProjection(inputs.webAumlokProjection),
      'utf8',
    ))
    // The two selected bundle manifests and patch files enter the digest, so a
    // changed bundle byte refuses at re-entry rather than silently composing
    // configuration the parent-staged literal overrides were never proven to
    // cover.
    composition.bundleBaseManifestSha256 = fileSha256(BUNDLE_BASE_MANIFEST)
    composition.bundleBasePatchSha256 = fileSha256(BUNDLE_BASE_PATCH)
    composition.bundleWebAppManifestSha256 = fileSha256(BUNDLE_WEB_APP_MANIFEST)
    composition.bundleWebAppPatchSha256 = fileSha256(BUNDLE_WEB_APP_PATCH)
  }
  if (liveTurn !== undefined) {
    composition.liveTurnOverlaySha256 = fileSha256(LIVE_TURN_OVERLAY)
    if (liveTurn.fixture === true) {
      composition.liveTurnFixtureOverlaySha256 = fileSha256(LIVE_TURN_FIXTURE_OVERLAY)
      composition.liveTurnFixtureLlmSha256 = fileSha256(LIVE_TURN_FIXTURE_LLM)
    }
  }
  if (inputs.kiraRecallPolicy !== undefined) {
    composition.kiraRecallPolicySha256 = sha256(Buffer.from(
      canonicalJSON(inputs.kiraRecallPolicy),
      'utf8',
    ))
  }
  if (inputs.subjectAuthorityExpectation !== undefined) {
    composition.subjectAuthorityExpectationSha256 = sha256(Buffer.from(
      canonicalJSON(inputs.subjectAuthorityExpectation),
      'utf8',
    ))
  }
  if (web !== undefined) composition.webPort = web.port
  if (inputs.workspaceRoots !== undefined && Object.keys(inputs.workspaceRoots).length > 0) {
    composition.workspaceRootsSha256 = sha256(Buffer.from(canonicalJSON(inputs.workspaceRoots), 'utf8'))
  }
  const compositionDigest = sha256(Buffer.from(canonicalJSON(composition), 'utf8'))
  const resolver = {
    'root-package-manifest': measureLaunchMember(ROOT_PACKAGE_MANIFEST),
    'workspace-lockfile': measureLaunchMember(WORKSPACE_LOCK),
    'workspace-layout': measureLaunchMember(WORKSPACE_LAYOUT),
    'tsx-paths-root': measureLaunchMember(TSCONFIG_ROOT),
    'tsx-paths-base': measureLaunchMember(TSCONFIG_BASE),
    'tsx-host-program': measureLaunchMember(TSCONFIG_HOST),
    'source-profile-manifest': measureLaunchMember(sourceManifest),
    'source-profile-patch': measureLaunchMember(sourcePatch),
    'staged-profile-manifest': measureLaunchMember(inputs.stagedManifestPath),
    'staged-profile-patch': measureLaunchMember(inputs.stagedPatchPath),
    'profile-boot': measureLaunchMember(PROFILE_BOOT),
  }
  if (inputs.guestConfinement !== undefined) {
    resolver['guest-confinement-profile'] = inputs.guestConfinement.profileSha256
    resolver['guest-confinement-launcher'] = measureLaunchMember(GUEST_CONFINEMENT_ENTRY)
    resolver['prepared-profile-boot'] = measureLaunchMember(PREPARED_PROFILE_BOOT)
    for (const entry of readdirSync(dirname(PREPARED_PROFILE_BOOT)).filter(name => name.endsWith('.js')).sort()) {
      resolver[`prepared-cli/${entry}`] = measureLaunchMember(join(dirname(PREPARED_PROFILE_BOOT), entry))
    }
    resolver['staged-profile-root'] = measureLaunchMember(join(dirname(inputs.stagedManifestPath), 'cordis.yml'))
  }
  if (web !== undefined) {
    if (inputs.reviewConfigurationDigest !== undefined) resolver['owner-review-configuration'] = inputs.reviewConfigurationDigest
    if (inputs.stagedProfile.operatorHome !== undefined) {
      resolver['operator-preset-composer'] = measureLaunchMember(WEB_OPERATOR_ENTRY)
      resolver['operator-standard-preset'] = measureLaunchMember(WEB_STANDARD_PRESET)
    }
    resolver['staged-profile-root'] = measureLaunchMember(join(dirname(inputs.stagedManifestPath), 'cordis.yml'))
    if (inputs.stagedProfile.capsulePatchPath !== undefined) {
      resolver['capsule-source-overlay'] = measureLaunchMember(WEB_CAPSULE_OVERLAY)
      resolver['capsule-owner-config-reader'] = measureLaunchMember(WEB_CAPSULE_CONFIG_ENTRY)
      resolver['capsule-staged-overlay'] = measureLaunchMember(inputs.stagedProfile.capsulePatchPath)
      resolver['capsule-worker-preset-manifest'] = measureLaunchMember(inputs.stagedProfile.workerPresetManifestPath)
      resolver['capsule-worker-preset-composition'] = measureLaunchMember(inputs.stagedProfile.workerPresetCompositionPath)
    }
    resolver['source-preset-manifest'] = measureLaunchMember(WEB_PRESET_MANIFEST)
    resolver['source-preset-composition'] = measureLaunchMember(WEB_PRESET_COMPOSITION)
    resolver['staged-preset-manifest'] = measureLaunchMember(inputs.stagedProfile.presetManifestPath)
    resolver['staged-preset-composition'] = measureLaunchMember(inputs.stagedProfile.presetCompositionPath)
    resolver['bundle-base-manifest'] = measureLaunchMember(BUNDLE_BASE_MANIFEST)
    resolver['bundle-base-patch'] = measureLaunchMember(BUNDLE_BASE_PATCH)
    resolver['bundle-web-app-manifest'] = measureLaunchMember(BUNDLE_WEB_APP_MANIFEST)
    resolver['bundle-web-app-patch'] = measureLaunchMember(BUNDLE_WEB_APP_PATCH)
  }
  if (liveTurn !== undefined) {
    resolver['live-turn-overlay'] = measureLaunchMember(LIVE_TURN_OVERLAY)
    if (liveTurn.fixture === true) {
      resolver['live-turn-fixture-overlay'] = measureLaunchMember(LIVE_TURN_FIXTURE_OVERLAY)
      resolver['live-turn-fixture-llm'] = measureLaunchMember(LIVE_TURN_FIXTURE_LLM)
    }
  }
  return parseActivationStatement({
    domain: ACTIVATION_STATEMENT_DOMAIN,
    epoch: inputs.epoch,
    coreManifest: authorityCoreManifest(),
    compositionDigest,
    closure: {
      executable: measureDigestManifest([
        { name: 'node', path: process.execPath },
        { name: 'activation-measure', path: ACTIVATION_MEASURE_ENTRY },
        { name: 'activation-statement', path: ACTIVATION_STATEMENT_ENTRY },
        { name: 'parent-launcher', path: DEVELOPER_LAUNCH_ENTRY },
        { name: 'issuer-approval-bridge', path: ISSUER_APPROVAL_BRIDGE_ENTRY },
        { name: 'developer-launch-error', path: DEVELOPER_LAUNCH_ERROR_ENTRY },
        {
          name: 'parent-terminal-renderer',
          path: web !== undefined
            ? WEB_BIN_ENTRY
            : liveTurn === undefined ? DEVELOPER_LAUNCH_BIN_ENTRY : LIVE_TURN_BIN_ENTRY,
        },
        {
          name: 'guest-entry',
          path: web !== undefined
            ? WEB_GUEST_ENTRY
            : liveTurn === undefined ? GUEST_ENTRY : LIVE_TURN_GUEST_ENTRY,
        },
        ...(web === undefined ? [] : [{
          name: 'parent-terminal-review',
          path: DEVELOPER_TERMINAL_ENTRY,
        }, {
          name: 'parent-owner-review',
          path: DEVELOPER_REVIEW_ENTRY,
        }, {
          name: 'owner-review-client',
          path: WEB_REVIEW_CLIENT_ENTRY,
        }, {
          name: 'owner-review-transport',
          path: REVIEW_TRANSPORT_ENTRY,
        }, {
          name: 'owner-review-socket',
          path: REVIEW_SOCKET_ENTRY,
        }, ...OWNER_BROWSER_MEMBERS]),
        ...(inputs.subjectAuthorityExpectation === undefined ? [] : [{
          name: 'parent-aumlok-authority',
          path: DEVELOPER_AUMLOK_ENTRY,
        }, {
          name: 'local-aumlok-control',
          path: LOCAL_AUMLOK_CONTROL_ENTRY,
        }]),
      ], { allowAncestorLinks: true }),
      resolver,
    },
    proposalCellSha256: MEMORY_PUT_PROPOSAL_WASM_SHA256,
    rendererId: inputs.rendererId,
    modelEmissionPolicy: web !== undefined
      ? WEB_MODEL_EMISSION_POLICY
      : liveTurn === undefined
        ? SOURCE_MODEL_EMISSION_POLICY
        : liveTurn.fixture === true
          ? LIVE_TURN_FIXTURE_MODEL_EMISSION_POLICY
          : LIVE_TURN_MODEL_EMISSION_POLICY,
    issuerId: inputs.issuerId,
    brokerId: inputs.brokerId,
  })
}

/**
 * Measure every exact static issuer/broker module plus the graph selector.
 *
 * The graph selector cannot include itself in its own frozen digest without a
 * self-referential value. Binding its source alongside every returned node
 * prevents a changed root set or parser from silently shrinking this manifest.
 *
 * @returns {Readonly<Record<string, string>>} complete static authority manifest.
 */
function authorityCoreManifest() {
  const graph = verifierGraph()
  const manifest = {
    ...measureVerifiedDigestManifest(graph.nodes.map(node => ({
      name: `aukora/${node.path}`,
      path: join(ROOT, 'aukora', node.path),
      sha256: node.sha256,
    })), { allowAncestorLinks: true }),
  }
  const selectorName = 'aukora/host-dsh/src/verifier-bytes.mjs'
  if (Object.hasOwn(manifest, selectorName)) {
    throw new DeveloperLaunchError('supervisor:activation-core-graph-invalid', 'authority graph includes its own selector')
  }
  manifest[selectorName] = measureLaunchMember(VERIFIER_GRAPH_ENTRY)
  return Object.freeze(manifest)
}

/** Read a non-link public-key file without accepting mutable object types. */
function readExactPublicKey(path) {
  const entry = lstatSync(path)
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new DeveloperLaunchError('supervisor:root-public-key-malformed', 'public key path must be an exact regular file')
  }
  return readFileSync(path, 'utf8')
}

/** Minimal environment for the source guest; credentials cross only to model surfaces. */
function guestEnvironment(
  paths,
  liveTurn,
  web,
  stagedProfile,
  webAumlokProjectionJson,
  kiraRecallPolicy,
  confinement,
) {
  if (confinement !== undefined) return {
    DSH_HOME: paths.activationHome, DSH_TELEMETRY_DISABLED: '1',
    HOME: confinement.scratch, TMPDIR: confinement.scratch, LANG: 'C', LC_ALL: 'C',
    __CF_USER_TEXT_ENCODING: `0x${process.geteuid().toString(16)}:0:0`,
  }
  const env = {
    DSH_HOME: paths.activationHome,
    DSH_TELEMETRY_DISABLED: '1',
    HOME: stagedProfile.operatorHome ?? paths.guestHome,
    LANG: process.env.LANG ?? 'C.UTF-8',
  }
  if (typeof process.env.PATH === 'string') env.PATH = process.env.PATH
  if (process.platform === 'darwin' && typeof process.env.__CF_USER_TEXT_ENCODING === 'string') {
    env.__CF_USER_TEXT_ENCODING = process.env.__CF_USER_TEXT_ENCODING
  }
  if (web !== undefined) {
    env.AUKORA_PRESET_ROOT = stagedProfile.presetRoot
    if (stagedProfile.capsulePatchPath !== undefined) env.AUKORA_CAPSULE_PATCH = stagedProfile.capsulePatchPath
    env.AUKORA_WEB_PORT = String(web.port)
    env[DEVELOPER_AUMLOK_PROJECTION_ENV] = webAumlokProjectionJson
  }
  if (liveTurn !== undefined) {
    env.AUKORA_LIVE_TURN_OVERLAY = LIVE_TURN_OVERLAY
    env.AUKORA_LIVE_TURN_MODE = liveTurn.fixture ? 'fixture' : 'live'
    env.AUKORA_LIVE_TURN_AUMLOK_SUBJECT = kiraRecallPolicy.subject
    env.AUKORA_LIVE_TURN_KIRA_PRIVACY = kiraRecallPolicy.privacy[0]
    if (liveTurn.fixture) {
      env.AUKORA_LIVE_TURN_FIXTURE_OVERLAY = LIVE_TURN_FIXTURE_OVERLAY
    }
  }
  if ((web !== undefined || liveTurn?.fixture === false)
    && typeof process.env.DEEPSEEK_API_KEY === 'string'
    && process.env.DEEPSEEK_API_KEY !== '') {
    env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY
    if (typeof process.env.DEEPSEEK_BASE_URL === 'string' && process.env.DEEPSEEK_BASE_URL !== '') {
      env.DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL
    }
  }
  return env
}

/** Environment inherited by an authority child before its exact fields are added. */
function childEnvironment() {
  return { LANG: process.env.LANG ?? 'C.UTF-8' }
}

/** Ask one newline-delimited broker request and require one terminal line. */
function brokerRequest(socketPath, request) {
  return new Promise((resolveReply, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    let settled = false
    const finish = (callback) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      callback()
    }
    const timer = setTimeout(() => finish(() => reject(new DeveloperLaunchError('supervisor:broker-timeout', 'broker request timed out'))), 5_000)
    socket.once('connect', () => { socket.write(`${JSON.stringify(request)}\n`) })
    socket.once('error', (error) => finish(() => reject(error)))
    socket.once('close', () => finish(() => reject(new DeveloperLaunchError('supervisor:broker-closed', 'broker closed without a reply'))))
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const cut = buffer.indexOf('\n')
      if (cut === -1) return
      finish(() => {
        try {
          resolveReply(JSON.parse(buffer.slice(0, cut)))
        } catch (error) {
          reject(new DeveloperLaunchError('supervisor:broker-reply-malformed', error instanceof Error ? error.message : String(error)))
        }
      })
    })
  })
}
/** Connect successfully to the exact route before allowing the next phase. */
async function waitForSocket(path, child, label) {
  const deadline = Date.now() + 5_000
  for (;;) {
    const connected = await new Promise((resolveConnected) => {
      const socket = createConnection(path)
      socket.once('connect', () => { socket.destroy(); resolveConnected(true) })
      socket.once('error', () => resolveConnected(false))
    })
    if (connected) return
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new DeveloperLaunchError(`supervisor:${label}-not-ready`, 'child exited before its route accepted a connection')
    }
    if (Date.now() >= deadline) {
      throw new DeveloperLaunchError(`supervisor:${label}-not-ready`, 'route did not accept a connection within 5000ms')
    }
    await new Promise((resolveDelay) => { setTimeout(resolveDelay, 10) })
  }
}

/** Require readiness over the IPC channel tied to the exact child process. */
function waitForGuestReady(child, expectedProfile, expectedEnvironmentKeys, timeoutMs = 10_000) {
  return new Promise((resolveReady, reject) => {
    let settled = false
    const finish = (callback) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.removeListener('message', onMessage)
      child.removeListener('error', onError)
      child.removeListener('exit', onExit)
      callback()
    }
    const onMessage = (message) => {
      const exact = isExactObject(message, ['type', 'profile', 'governed', 'environmentKeys', 'globalTools', 'pid'])
        && message.type === GUEST_READY_TYPE
        && message.profile === expectedProfile
        && message.governed === true
        && exactStringArray(message.environmentKeys, expectedEnvironmentKeys)
        && Array.isArray(message.globalTools)
        && message.globalTools.every(name => typeof name === 'string' && name.length > 0)
        && message.pid === child.pid
      if (!exact) {
        const receivedKeys = Array.isArray(message?.environmentKeys)
          ? message.environmentKeys.filter(entry => typeof entry === 'string')
          : []
        finish(() => reject(new DeveloperLaunchError(
          'supervisor:guest-readiness-malformed',
          `guest sent an unexpected IPC record (environment ${JSON.stringify(receivedKeys)}; expected ${JSON.stringify(expectedEnvironmentKeys)})`,
        )))
        return
      }
      finish(() => { resolveReady(Object.freeze([...message.globalTools])) })
    }
    const onExit = (code, signal) => finish(() => reject(new DeveloperLaunchError(
      'supervisor:guest-not-ready',
      `guest exited with code ${code ?? 'null'} signal ${signal ?? 'null'}`,
    )))
    const onError = error => finish(() => reject(new DeveloperLaunchError(
      'supervisor:guest-spawn-error',
      error instanceof Error ? error.message : String(error),
    )))
    const timer = setTimeout(() => finish(() => reject(new DeveloperLaunchError('supervisor:guest-not-ready', `guest did not report readiness within ${String(timeoutMs)}ms`))), timeoutMs)
    child.once('message', onMessage)
    child.once('error', onError)
    child.once('exit', onExit)
  })
}

function exactStringArray(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => typeof entry === 'string' && entry === expected[index])
}

/** Execute one request inside the direct-child Cordis guest. */
function executeGuestRequest(child, payload) {
  const requestId = randomBytes(16).toString('hex')
  return new Promise((resolveResult, reject) => {
    let settled = false
    let ceilingReached = false
    const finish = (callback) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.removeListener('message', onMessage)
      child.removeListener('exit', onExit)
      callback()
    }
    const onMessage = (message) => {
      if (message?.requestId !== requestId) return
      const exact = isExactObject(message, ['type', 'requestId', 'outcome', 'result'])
        && message.type === GUEST_RESULT_TYPE
        && SOURCE_OUTCOMES.has(message.outcome)
        && typeof message.result === 'object'
        && message.result !== null
        && !Array.isArray(message.result)
        && typeof message.result.isError === 'boolean'
        && Array.isArray(message.result.content)
      if (!exact) {
        finish(() => reject(new DeveloperLaunchError('supervisor:guest-result-malformed', 'guest sent an unexpected result record')))
        return
      }
      const derivedOutcome = classifyMemoryToolResult(message.result)
      if (derivedOutcome === null || derivedOutcome !== message.outcome) {
        finish(() => reject(new DeveloperLaunchError('supervisor:guest-result-malformed', 'guest result contradicts its outcome')))
        return
      }
      finish(() => resolveResult(Object.freeze({ outcome: message.outcome, result: message.result })))
    }
    const onExit = (code, signal) => finish(() => {
      if (ceilingReached) {
        resolveResult(indeterminateExecution(`no terminal result within ${String(GUEST_OPERATION_CEILING_MS)}ms; guest terminated before outcome was known`))
        return
      }
      reject(new DeveloperLaunchError(
        'supervisor:guest-exited-during-operation',
        `code ${code ?? 'null'} signal ${signal ?? 'null'}`,
      ))
    })
    const timer = setTimeout(() => {
      ceilingReached = true
      if (!child.kill('SIGKILL')) {
        finish(() => resolveResult(indeterminateExecution(
          `no terminal result within ${String(GUEST_OPERATION_CEILING_MS)}ms`,
        )))
      }
    }, GUEST_OPERATION_CEILING_MS)
    child.on('message', onMessage)
    child.once('exit', onExit)
    try {
      child.send({ ...payload, requestId }, (error) => {
        if (error !== null && error !== undefined) finish(() => reject(error))
      })
    } catch (error) {
      finish(() => reject(error))
    }
  })
}

/** Materialize one parent-owned indeterminate result after terminating the guest. */
function indeterminateExecution(message) {
  const result = Object.freeze({
    content: Object.freeze([{ type: 'text', text: `Error: ${message}` }]),
    isError: true,
    error: Object.freeze({
      message,
      info: Object.freeze({ name: 'DeveloperLaunchError', code: AUKORA_MEMORY_INDETERMINATE }),
    }),
  })
  return Object.freeze({ outcome: SOURCE_OUTCOME_INDETERMINATE, result })
}

const INVALID_JSON_VALUE = Symbol('invalid-json-value')

/** Detach the JSON value accepted by the parent-to-guest IPC channel. */
function snapshotDeveloperJsonValue(value, ancestors = new WeakSet(), depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    return Number.isFinite(value) && !Object.is(value, -0) ? value : INVALID_JSON_VALUE
  }
  if (typeof value !== 'object' || depth > 64 || ancestors.has(value)) return INVALID_JSON_VALUE
  try {
    ancestors.add(value)
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_OPERATION_BYTES) {
        return INVALID_JSON_VALUE
      }
      const ownKeys = Reflect.ownKeys(value)
      if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) return INVALID_JSON_VALUE
      const snapshot = []
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          return INVALID_JSON_VALUE
        }
        const item = snapshotDeveloperJsonValue(descriptor.value, ancestors, depth + 1)
        if (item === INVALID_JSON_VALUE) return INVALID_JSON_VALUE
        snapshot.push(item)
      }
      return Object.freeze(snapshot)
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return INVALID_JSON_VALUE
    const ownKeys = Reflect.ownKeys(value)
    if (ownKeys.length > MAX_OPERATION_BYTES || ownKeys.some(key => typeof key !== 'string')) {
      return INVALID_JSON_VALUE
    }
    const snapshot = Object.create(null)
    for (const key of ownKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        return INVALID_JSON_VALUE
      }
      const item = snapshotDeveloperJsonValue(descriptor.value, ancestors, depth + 1)
      if (item === INVALID_JSON_VALUE) return INVALID_JSON_VALUE
      snapshot[key] = item
    }
    return Object.freeze(snapshot)
  } catch {
    return INVALID_JSON_VALUE
  } finally {
    ancestors.delete(value)
  }
}

/** Stop one direct child and wait for its exit, escalating after five seconds. */
function stopChild(child, label) {
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolveStopped, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // The exit check below owns an already-stopped child.
      }
    }, 5_000)
    const finalTimer = setTimeout(() => {
      cleanup()
      reject(new DeveloperLaunchError(`supervisor:${label}-stop-timeout`, 'child did not exit after SIGKILL'))
    }, 10_000)
    const cleanup = () => {
      if (settled) return false
      settled = true
      clearTimeout(timer)
      clearTimeout(finalTimer)
      child.removeListener('exit', onExit)
      return true
    }
    const onExit = () => {
      if (!cleanup()) return
      resolveStopped()
    }
    child.once('exit', onExit)
    if (child.exitCode !== null || child.signalCode !== null) {
      onExit()
      return
    }
    try {
      child.kill('SIGTERM')
    } catch (error) {
      if (child.exitCode !== null || child.signalCode !== null) onExit()
      else {
        if (!cleanup()) return
        reject(error)
      }
    }
  })
}

function fileSha256(path) {
  return sha256(readFileSync(path))
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function requireAbsolutePath(value, subject) {
  if (typeof value !== 'string' || !isAbsolute(value) || normalize(value) !== value || !PLAIN_PATH.test(value)) {
    throw new DeveloperLaunchError('supervisor:launch-path-malformed', `${subject} must be an absolute normalized path`)
  }
}

function requireExactObject(value, keys, reason) {
  if (!isExactObject(value, keys)) throw new DeveloperLaunchError(reason, `expected exactly ${keys.join(', ')}`)
}

function isExactObject(value, keys) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const own = Reflect.ownKeys(value)
  if (own.length !== keys.length) return false
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && descriptor.enumerable && Object.hasOwn(descriptor, 'value')
  })
}
