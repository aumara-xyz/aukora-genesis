import type { ChildProcess } from 'node:child_process'
import type { ActivationStatementV1 } from '../activation/statement.d.mts'
import type {
  SubjectAuthorityContextInput,
  SubjectAuthorityExpectationInput,
} from '../broker/subject-authority.d.mts'
import type { BrokerAuthorityRequest } from '../broker/broker.d.mts'
import type { RootControlStateV1 } from '../identity/control.mjs'
import type { AukoraId } from '../identity/genesis.mjs'
import type { DeveloperIssuerApproval } from './issuer-approval-bridge.mjs'

export { DeveloperLaunchError } from './developer-launch-error.mjs'
export { installIssuerApprovalBridge } from './issuer-approval-bridge.mjs'
export type {
  DeveloperIssuerApproval,
  DeveloperIssuerApprovalDecision,
  DeveloperIssuerApprovalRequest,
} from './issuer-approval-bridge.mjs'

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
import type {
  DEVELOPER_LAUNCH_SCHEMA,
  DEVELOPER_OBSERVATION_CLASS,
  SOURCE_OUTCOME_INDETERMINATE,
  SOURCE_OUTCOME_REFUSED,
  SOURCE_OUTCOME_SETTLED,
} from './developer-protocol.mjs'

export type DeveloperJsonValue = null | boolean | number | string | DeveloperJsonValue[] | {
  [key: string]: DeveloperJsonValue
}

/** Exact public AUMLOK metadata the parent exposes to the Web projection. */
export interface DeveloperAumlokProjection {
  readonly subject: AukoraId
  readonly epoch: number
  readonly activeControlDigest: string
  readonly grantDomain: 'aukora:tool-grant:v5'
  readonly custodyClass: 'same-uid-posix-mode-only'
}

export interface DeveloperLaunchConfig {
  readonly schema: typeof DEVELOPER_LAUNCH_SCHEMA
  readonly runtimeDir: string
  readonly rootPrivateKeyFile: string
  readonly rootPublicKeyFile: string
  readonly kiraSubject?: string
  readonly kiraPrivacy?: readonly string[]
}

export interface DeveloperGuestResult extends Readonly<Record<string, unknown>> {
  readonly content: readonly Readonly<Record<string, unknown>>[]
  readonly isError: boolean
}

export type DeveloperSourceOutcome =
  | typeof SOURCE_OUTCOME_SETTLED
  | typeof SOURCE_OUTCOME_REFUSED
  | typeof SOURCE_OUTCOME_INDETERMINATE

export interface DeveloperExecutionResult {
  readonly outcome: DeveloperSourceOutcome
  readonly result: DeveloperGuestResult
}

export interface DeveloperAssembly {
  /** Digest of the one activation this launch validated and the broker adopted. */
  readonly activationDigest: string
  /** The complete statement that digest was taken over. It never crosses a process frame. */
  readonly activationStatement: ActivationStatementV1
  readonly artifact: Readonly<{
    activationDigest: string
    brokerEntrySha256: string
    guestEntrySha256: string
    issuerEntrySha256: string
    profileBootSha256: string
    profileManifestSha256: string
    profilePatchSha256: string
    proposalCellModuleSha256: string
    sourceProfileManifestSha256: string
    sourceProfileSha256: string
    aumlokProjectionSha256?: string
    guestConfinementProfileSha256?: string
  }>
  readonly broker: ChildProcess
  readonly issuer: ChildProcess
  readonly guest: ChildProcess
  readonly observationClass: typeof DEVELOPER_OBSERVATION_CLASS | 'MACOS_SEATBELT_GUEST / SAME_UID_AUTHORITIES / NO_CUSTODY_CLAIM'
  /**
   * Fixed paths of this launch. With a durable data root, `activationHome`,
   * `guestHome` and `stateDir` sit under it and outlive the assembly, and the
   * socket route is a stable location derived from that root rather than from
   * the ambient temporary directory. `runtimeDir` is always per-launch.
   */
  readonly paths: Readonly<{
    activationHome: string
    brokerSocket: string
    guestHome: string
    issuerSocket: string
    runtimeDir: string
    stateDir: string
  }>
  readonly failure: Promise<never>
  executeMemoryPut(args: Readonly<{key: string; value: DeveloperJsonValue}>): Promise<DeveloperExecutionResult>
  executeUserTurn(prompt: string): Promise<DeveloperExecutionResult>
  /**
   * Restart the Web guest when the caller knows browser work is idle.
   *
   * The restart refuses with `supervisor:activation-input-changed` before
   * stopping the serving guest when the retained activation no longer
   * reproduces its original digest.
   *
   * @returns replacement guest process identifier when the child exposes one.
   */
  restartGuest(): Promise<number | undefined>
  close(): Promise<void>
}

/** SHA-256 of the source CLI module that owns terminal review and input. */
export declare const SOURCE_RENDERER_ID: string
export declare const WEB_RENDERER_ID: string
export declare const SOURCE_MODEL_EMISSION_POLICY: 'aukora:model-emission:none:v1'
export declare const LIVE_TURN_MODEL_EMISSION_POLICY: 'aukora:model-emission:parent-staged-loop:v1'
export declare const LIVE_TURN_FIXTURE_MODEL_EMISSION_POLICY: 'aukora:model-emission:parent-staged-loop-fixture:v1'
export declare const WEB_MODEL_EMISSION_POLICY: 'aukora:model-emission:parent-staged-web:v1'
export declare const SOURCE_LIVE_TURN_OVERLAY_SHA256: string
export declare const SOURCE_LIVE_TURN_FIXTURE_OVERLAY_SHA256: string

export declare function buildSourceActivationStatement(inputs: {
  workspaceRoots?: Readonly<Record<string, string>>
  reviewConfigurationDigest?: string
  stagedManifestPath: string
  stagedPatchPath: string
  stagedProfile: Readonly<{
    manifestSha256: string
    patchSha256: string
    presetManifestPath?: string
    presetManifestSha256?: string
    presetCompositionPath?: string
    presetCompositionSha256?: string
    capsulePatchPath?: string
    workerPresetManifestPath?: string
    workerPresetCompositionPath?: string
    operatorHome?: string
  }>
  rendererId: string
  issuerId: string
  brokerId: string
  epoch: number
  liveTurn?: Readonly<{ fixture?: boolean }>
  web?: Readonly<{ port: number }>
  guestConfinement?: Readonly<{ mode: 'macos-seatbelt'; profileSha256: string }>
  webAumlokProjection?: Readonly<DeveloperAumlokProjection>
  kiraRecallPolicy?: Readonly<{ subject: string; privacy: readonly string[] }>
  subjectAuthorityExpectation?: Readonly<{
    subject: AukoraId
    activeControlDigest: string
    audience: string
  }>
}): ActivationStatementV1

/** Reviewed source bytes for the four-row 8088 profile before route substitution. */
export declare const SOURCE_PROFILE_PATCH_SHA256: string

export declare function parseDeveloperLaunchConfig(input: string | Buffer | unknown): Readonly<DeveloperLaunchConfig>
/** Validate canonical workspace aliases disjoint from protected paths, without writing. */
export declare function readDeveloperWorkspaceRoots(input: Readonly<Record<string, string>>, protectedPaths?: readonly string[]): Readonly<Record<string, string>>
export declare function parseDeveloperMemoryPut(input: string | Buffer | unknown): Readonly<{key: string; value: DeveloperJsonValue}>
export declare function parseDeveloperLiveTurn(input: string | Buffer | unknown): Readonly<{schema: 'aukora:live-turn:v1'; prompt: string}>
/** Refuse source-profile configuration changes while allowing its optional AGPL license metadata. */
export declare function validateSourceProfileManifest(sourceManifest: unknown): void
/** Refuse unreviewed profile bytes before the parent substitutes its broker route. */
export declare function validateSourceProfilePatch(sourcePatch: unknown): void
/** Refuse unreviewed live-turn overlay bytes before the parent stages them. */
export declare function validateLiveTurnOverlays(fixture: boolean): void

export declare function launchDeveloperAssembly(options: {
  workspaceRoots?: Readonly<Record<string, string>>
  runtimeDir: string
  /**
   * Parent-owned durable root for the stores that outlive one launch: the DSH
   * home holding sessions and settings, the guest home, and the broker state
   * holding KIRA objects, receipts, Aura, and authority evidence. Absent, every
   * one of those lives in the per-launch runtime tree and is lost on exit. It
   * must be an absolute normalized path this uid owns with mode 0700.
   */
  dataDir?: string
  rootPrivateKeyFile: string
  rootPublicKeyFile: string
  /** Require macOS restriction and preflight for the prepared keyless guest. */
  guestConfinement?: 'macos-seatbelt'
  /** Active hybrid AUMLOK control head persisted in broker-owned state. */
  rootControlState?: RootControlStateV1
  rendererId: string
  /** SHA-256 identity of the parent-owned reconnectable review configuration. */
  reviewConfigurationDigest?: string
  review(request: object, signal: AbortSignal): Promise<'approved' | 'denied'> | 'approved' | 'denied'
  issuerApproval: DeveloperIssuerApproval
  issuerStderr?(text: string): void
  liveTurn?: Readonly<{ fixture?: boolean }>
  web?: Readonly<{ port: number }>
  webCapsule?: Readonly<{ worker: import('../../packages/governed/capsule/src/worker.ts').CapsuleWorkerConfig; protectedChecks: readonly { id: string; program: string; timeoutMs: number }[] }>
  /** Explicit native coding mode using this existing CLI authentication home; DSH state stays retained. Not broker confinement. */
  webOperatorHome?: string
  /** Exact browser-safe metadata for the required active Web controller. */
  webAumlokProjection?: Readonly<DeveloperAumlokProjection>
  kiraRecallPolicy?: Readonly<{ subject: string; privacy: readonly string[] }>
  /**
   * Parent-owned selection invoked after the launcher finalizes its activation
   * and before it spawns the broker. The returned context must name that digest.
   */
  createSubjectAuthority?(activationDigest: string): SubjectAuthorityContextInput
  /** Parent-owned selector for one exact proposal-specific authority context. */
  selectSubjectAuthority?(
    request: Readonly<BrokerAuthorityRequest>,
    signal: AbortSignal,
  ): Promise<SubjectAuthorityContextInput> | SubjectAuthorityContextInput
  /** Identity fields every proposal-specific authority selection must retain. */
  subjectAuthorityExpectation?: Omit<SubjectAuthorityExpectationInput, 'activationDigest'>
}): Promise<DeveloperAssembly>

/** Public inputs for measuring a stopped deployment's reconnectable Web target. */
export interface WebUpgradePreparation {
  stagingDir: string
  dataDir: string
  /** Canonical workspace aliases retained by the replacement launcher. */
  workspaceRoots?: Readonly<Record<string, string>>
  /** Selected Capsule configuration; requires existing private capsules storage and workspace aliases. */
  webCapsule?: Parameters<typeof launchDeveloperAssembly>[0]['webCapsule']
  /** Same explicitly selected native coding home used by the replacement launch. */
  webOperatorHome?: string
  rendererId: string
  reviewConfigurationDigest: string
  rootPublicKeyPem: string
  rootControlState: RootControlStateV1
  web: Readonly<{ port: number }>
  webAumlokProjection: Readonly<DeveloperAumlokProjection>
  selectSubjectAuthority: NonNullable<Parameters<typeof launchDeveloperAssembly>[0]['selectSubjectAuthority']>
  subjectAuthorityExpectation: NonNullable<Parameters<typeof launchDeveloperAssembly>[0]['subjectAuthorityExpectation']>
}

export declare function prepareWebUpgradeStatement(options: WebUpgradePreparation): ActivationStatementV1
