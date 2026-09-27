import type { ValidatedLaunchdInputs } from './generate-launchd-jobs.mjs'

/** Closed input document for the macOS launchd custody-pair installer. */
export interface CustodyPairPlan {
  format: 'aukora:launchd-custody-pair:v2'
  brokerLabel: string
  brokerUser: string
  brokerGroup: string
  brokerSocket: string
  brokerStateDir: string
  brokerUid: number
  brokerGid: number
  issuerLabel: string
  issuerUser: string
  issuerGroup: string
  issuerSocket: string
  issuerStateDir: string
  issuerKeyFile: string
  issuerUid: number
  issuerGid: number
  guestUser: string
  guestUid: number
  implementationRoot: string
  nodeBin: string
  nodeSha256: string
  launchDaemonDir: string
  /** Review route the broker publishes beside its own, in the same 0710 parent. */
  reviewSocket: string
  /** Operator-placed terminal public key, root-owned so the broker cannot replace it. */
  reviewTerminalPublicKeyFile: string
  /** Lowercase 64-character hex route identity the terminal pins. */
  reviewServerId: string
  /** Operator-placed activation statement, root-owned beside the terminal key. */
  activationStatementFile: string
  /** Lowercase 64-character hex digest that statement must measure to. */
  activationDigest: string
  /** Lowercase 64-character hex identity of the trusted renderer. */
  rendererId: string
  /** Explicit JSON recall policy; requires the complete memory bundle. */
  kiraRecallPolicy?: string
  /** Canonical Base64 session-to-agent authority; requires the complete memory bundle. */
  subjectAuthority?: string
  /** Root-owned 0644 public control-state file; requires the complete memory bundle. */
  rootControlStateFile?: string
  /** Optional operator prompt transport in the root-owned review directory. */
  issuerApprovalSocket?: string
  /** Canonical decimal operator uid, distinct from broker, issuer and guest. */
  issuerApprovalSocketUid?: string
}

/** Result returned by one no-follow file-access probe. */
export interface CustodyFileProbe {
  opened: boolean
  errno: string | null
}

/** Result returned by one Unix-socket connection probe. */
export interface CustodySocketProbe {
  connected: boolean
  errno: string | null
}

/** Positive and negative controls required for a custody observation. */
export interface CustodyProbes {
  guestBroker: CustodySocketProbe
  brokerIssuer: CustodySocketProbe
  guestIssuer: CustodySocketProbe
  issuerBroker: CustodySocketProbe
  issuerKey: CustodyFileProbe
  brokerKey: CustodyFileProbe
  guestKey: CustodyFileProbe
  brokerState: CustodyFileProbe
  guestState: CustodyFileProbe
  issuerState: CustodyFileProbe
}

/** Stable refusal names for host provisioning and observation. */
export declare const CUSTODY_PAIR_REFUSE: Readonly<{
  ARGUMENTS_NOT_EXACT: 'launchd-install:arguments-not-exact'
  INPUTS_UNREADABLE: 'launchd-install:inputs-unreadable'
  INPUTS_NOT_PLAIN: 'launchd-install:inputs-not-plain'
  FIELD_MISSING: 'launchd-install:field-missing'
  FIELD_UNKNOWN: 'launchd-install:field-unknown'
  FIELD_DUPLICATE: 'launchd-install:field-duplicate'
  FIELD_INVALID: 'launchd-install:field-invalid'
  PLATFORM_UNSUPPORTED: 'launchd-install:platform-unsupported'
  ROOT_REQUIRED: 'launchd-install:root-required'
  INVOCATION_TREE_UNTRUSTED: 'launchd-install:invocation-tree-untrusted'
  INSTALL_ACTIVE: 'launchd-install:install-active'
  INSTALL_LOCK_INDETERMINATE: 'launchd-install:install-lock-indeterminate'
  MANAGED_PATH_REQUIRED: 'launchd-install:managed-path-required'
  ID_COLLISION: 'launchd-install:id-collision'
  GROUP_CONFLICT: 'launchd-install:group-conflict'
  ACCOUNT_CONFLICT: 'launchd-install:account-conflict'
  MEMBERSHIP_CONFLICT: 'launchd-install:membership-conflict'
  HOST_OBSERVATION_FAILED: 'launchd-install:host-observation-failed'
  HOST_MUTATION_FAILED: 'launchd-install:host-mutation-failed'
  PARTIAL_STATE: 'launchd-install:partial-state'
  PATH_SYMLINK: 'launchd-install:path-symlink'
  PATH_CUSTODY_MISMATCH: 'launchd-install:path-custody-mismatch'
  ACL_UNOBSERVED: 'launchd-install:acl-unobserved'
  EXTENDED_ACL_PRESENT: 'launchd-install:extended-acl-present'
  IMPLEMENTATION_CONFLICT: 'launchd-install:implementation-conflict'
  IMPLEMENTATION_PUBLICATION_FAILED: 'launchd-install:implementation-publication-failed'
  PRINCIPAL_HELPER_FAILED: 'launchd-install:principal-helper-failed'
  PRINCIPAL_HELPER_MISMATCH: 'launchd-install:principal-helper-mismatch'
  PRINCIPAL_PROCESS_CONFLICT: 'launchd-install:principal-process-conflict'
  JOB_DEFINITION_CONFLICT: 'launchd-install:job-definition-conflict'
  JOB_PUBLICATION_FAILED: 'launchd-install:job-publication-failed'
  BOOTSTRAP_FAILED: 'launchd-install:bootstrap-failed'
  JOB_PRINCIPAL_MISMATCH: 'launchd-install:job-principal-mismatch'
  ROUTE_UNOBSERVED: 'launchd-install:route-unobserved'
  POSITIVE_CONTROL_FAILED: 'launchd-install:positive-control-failed'
  GUEST_REACHED_ISSUER: 'launchd-install:guest-reached-issuer'
  GUEST_REACHED_SECRET: 'launchd-install:guest-reached-secret'
  RUNTIME_BYTES_MISMATCH: 'launchd-install:runtime-bytes-mismatch'
  RUNTIME_CHANGED: 'launchd-install:runtime-changed'
}>

/**
 * Require every ancestor of this module and the repo root to be root-owned
 * without group or world write.
 *
 * @param options Fixture-injectable invocation locations.
 * @returns Nothing; refuses `launchd-install:invocation-tree-untrusted` on any untrusted ancestor.
 */
export declare function assertInvocationTree(options?: {
  modulePath?: string
  repoRoot?: string
  stat?: (path: string) => { isDirectory(): boolean, isSymbolicLink(): boolean, uid: number, mode: number }
}): void

/** Exact input document format. */
export declare const CUSTODY_PAIR_FORMAT: 'aukora:launchd-custody-pair:v2'

/** Measure stable descriptor bytes against the operator-selected runtime digest. */
export declare function measureLaunchdRuntime(path: string, expectedSha256: string): Readonly<{
  path: string
  sha256: string
  bytes: number
}>

/** Honest result class emitted only after active cross-principal probes hold. */
export declare const CUSTODY_PAIR_STATUS: 'PROVISIONED_DAEMON_PAIR'

/** Identity of one exclusive installer-lock inode. */
export interface InstallerLock {
  path: string
  dev: number
  ino: number
  uid: number
  gid: number
}

/** Coarse phases used to test installation sequencing without host mutation. */
export interface CustodyPairPhases {
  ensureIdentities(plan: Readonly<CustodyPairPlan>, apply: boolean): unknown
  prepareManaged(plan: Readonly<CustodyPairPlan>, apply: boolean): unknown
  observePreexisting(plan: Readonly<CustodyPairPlan>): { expectedEntries: unknown }
  provisionIdentities(plan: Readonly<CustodyPairPlan>, apply: boolean): {
    brokerIdentity: { receiptKeyId: string }
    brokerKeyFile: string
  }
  renderJobs(plan: Readonly<CustodyPairPlan>, principals: unknown): {
    jobs: { issuer: string, broker: string }
    paths: { issuer: string, broker: string }
  }
  publishJob(kind: 'issuer' | 'broker', path: string, content: string, apply: boolean): unknown
  rollbackPublished(publications: unknown[], cause: unknown): void
  loadJobs(plan: Readonly<CustodyPairPlan>, paths: { issuer: string, broker: string }, apply: boolean): string[]
  observeActive(plan: Readonly<CustodyPairPlan>, expectedEntries: unknown, brokerKeyFile: string): Promise<unknown>
  rollbackLoaded(labels: string[], cause: unknown): void
}

/** Coarse launchd operations accepted only by the sequencing helper. */
export interface LaunchdJobLoadOperations {
  observe(label: string): unknown | null
  bootstrap(label: string, path: string): { status: number | null, stderr: string }
  read(label: string): string | null
  rollback(labels: string[], cause: unknown): void
}

/** Acquire one exclusive installer lock; production callers use the fixed root-owned leaf. */
export declare function acquireInstallerLock(
  path?: string,
  owner?: { uid?: number, gid?: number },
): Readonly<InstallerLock>

/** Release only the exact installer-lock inode created by this invocation. */
export declare function releaseInstallerLock(lock: InstallerLock): void

/** Execute the custody-pair sequence without emitting a product status claim. */
export declare function executeCustodyPairPhases(
  plan: Readonly<CustodyPairPlan>,
  apply: boolean,
  phases: CustodyPairPhases,
): Promise<Readonly<Record<string, unknown>>>

/** Load missing jobs issuer-first and roll back only labels loaded by this call. */
export declare function ensureJobsLoaded(
  plan: Readonly<CustodyPairPlan>,
  paths: { issuer: string, broker: string },
  apply: boolean,
  operations?: LaunchdJobLoadOperations,
): string[]

/**
 * Return the content address required for the installed authority directory.
 *
 * @returns Canonical installed-manifest SHA-256.
 */
export declare function installedAuthorityManifestDigest(): string

/**
 * Publish or verify one root-owned read-only authority implementation and its
 * retained activation. Existing files must already match; none are replaced.
 * @param plan Implementation destination and operator statement.
 * @param apply Whether an absent implementation may be published.
 * @returns The observed implementation inventory.
 */
export declare function stageAuthority(
  plan: Readonly<Pick<CustodyPairPlan, 'implementationRoot' | 'activationStatementFile'>>,
  apply: boolean,
): Readonly<{ frozenVerifierSha256: string, manifestSha256: string, files: number }>

/**
 * Publish or verify one root-owned read-only staged root holding exactly one file set.
 * An absent root is created and sealed; an existing root is only observed, never rewritten.
 * @param root Absolute staged-root path, already content-addressed by its caller.
 * @param expectedFiles The complete file set, keyed by root-relative path.
 * @param apply Whether an absent root may be published.
 */
export declare function publishStagedRoot(
  root: string,
  expectedFiles: ReadonlyMap<string, { path: string, bytes: Buffer, sha256: string }>,
  apply: boolean,
): void

/**
 * Require one directory to have exact custody, creating it when the caller may apply.
 * @param path Absolute directory path.
 * @param options Required custody, and whether an absent directory may be created.
 */
export declare function ensureDirectory(
  path: string,
  options: Readonly<{ uid: number, gid: number, mode: number, apply: boolean }>,
): void

/**
 * Require one exact root-owned directory whose group and other cannot write.
 * @param path Absolute directory path.
 */
export declare function assertRootManagedDirectory(path: string): void

/** A named, machine-readable installation refusal. */
export declare class CustodyPairError extends Error {
  readonly reason: string
  constructor(reason: string, detail: string)
}

/**
 * Parse one closed custody-pair plan.
 *
 * @param raw Candidate JSON value.
 * @param repoDir Checkout path that installed state must not occupy.
 * @returns A validated frozen plan.
 */
export declare function validateCustodyPairPlan(
  raw: unknown,
  repoDir?: string,
): Readonly<CustodyPairPlan>

/** Require root custody on the optional public control-state file and every ancestor. */
export declare function requireRootControlStateFile(plan: Readonly<CustodyPairPlan>): void

/**
 * Parse one JSON object while refusing duplicate top-level field spellings.
 *
 * @param text Raw JSON text.
 * @returns Parsed JSON value.
 */
export declare function parseCustodyPairJson(text: unknown): unknown

/**
 * Parse a `dscl -list ... id` result into an exact name-to-id map.
 *
 * @param text Raw command output.
 * @param kind Identity class used in refusal details.
 * @returns Parsed name-to-id assignments.
 */
export declare function parseIdentityList(
  text: unknown,
  kind: string,
): Map<string, number>

/**
 * Parse exact one-line `dscl -read` attributes.
 *
 * @param text Raw command output.
 * @param requiredFields Attributes that must occur exactly once.
 * @returns Parsed attribute values.
 */
export declare function parseDsclRecord(
  text: unknown,
  requiredFields: readonly string[],
): Map<string, string>

/**
 * Parse numeric supplementary and primary groups from `id -G`.
 *
 * @param text Raw command output.
 * @returns Parsed numeric group identifiers.
 */
export declare function parseNumericGroups(text: unknown): Set<number>

/**
 * Parse bounded process rows used for service-uid exclusivity observations.
 *
 * @param text Raw `ps` output.
 * @returns Parsed process identities and commands.
 */
export declare function parseProcessList(text: unknown): ReadonlyArray<Readonly<{
  pid: number
  uid: number
  gid: number
  command: string
}>>

/**
 * Grade active allow and deny probes without treating absence as denial.
 *
 * @param probes Complete positive and negative controls.
 * @returns Public route and deprivation observations.
 */
export declare function gradeCustodyProbes(probes: CustodyProbes): Readonly<{
  brokerToIssuer: 'CONNECTED'
  guestToBroker: 'CONNECTED'
  issuerToBroker: string
  guestToIssuer: string
  brokerToIssuerKey: string
  guestToIssuerKey: string
  guestToBrokerState: string
  issuerToBrokerState: string
}>

/**
 * Apply or check the bounded installed pair on the live macOS host.
 *
 * @param rawPlan Candidate plan.
 * @param options Execution mode and testable host identity.
 * @returns Public observation report.
 */
export declare function runCustodyPair(
  rawPlan: unknown,
  options?: { apply: boolean, platform?: string, euid?: number },
): Promise<Readonly<Record<string, unknown>>>

/**
 * Return every file the installer stages under the implementation root.
 *
 * Exposed so a test can assert that the broker entry's whole relative-import
 * closure is staged, and can stand up a scratch implementation root holding
 * exactly these bytes.
 *
 * @returns Staged files, with paths relative to the implementation root.
 */
export declare function installedAuthorityFiles(): readonly { path: string, bytes: Buffer, sha256: string }[]

/**
 * Assemble the generator inputs the installer renders the launchd jobs from.
 *
 * Exported so a test can drive the real installer-to-generator connection
 * rather than a separately constructed generator fixture.
 *
 * @param plan Validated custody-pair plan.
 * @param rootPublicKeyPem Canonical Ed25519 root public key.
 * @param brokerPublicKeyPem Canonical Ed25519 broker receipt key.
 * @returns Generator inputs validated against this checkout.
 * @throws On any field the generator requires that the plan cannot supply.
 */
export declare function launchInputs(
  plan: CustodyPairPlan,
  rootPublicKeyPem: string,
  brokerPublicKeyPem: string,
): ValidatedLaunchdInputs

/** One expected launchd job program: the interpreter and the module it runs. */
export interface ExpectedJobEntry {
  nodeBin: string
  module: string
}

/**
 * Return the exact program each installed job must be observed running.
 *
 * One definition serves both program comparisons: the pre-existing pair
 * observation and the post-bootstrap active pair observation. Load and rollback
 * observation checks liveness only and passes no expected program.
 *
 * @param plan Validated custody-pair plan.
 * @returns The expected issuer and broker programs.
 */
export declare function expectedJobEntries(plan: CustodyPairPlan): Readonly<{
  issuer: Readonly<ExpectedJobEntry>
  broker: Readonly<ExpectedJobEntry>
}>

/**
 * Return whether one observed process command is exactly the expected program.
 *
 * The comparison is exact and positional: any extra argument, any other
 * interpreter, and any other module refuse.
 *
 * @param command Whitespace-split `ps -o command=` output.
 * @param expectedEntry The expected program.
 * @returns Whether the observed command is the expected program.
 */
export declare function jobCommandMatches(command: readonly string[], expectedEntry: ExpectedJobEntry): boolean

/**
 * Require the operator-supplied terminal public key under exact root custody.
 *
 * The installer never creates this file and never handles the terminal private
 * key: the human holding that key places the public half as root, and the
 * broker principal can read it but cannot replace it.
 *
 * @param plan Validated custody-pair plan.
 * @returns The canonical Ed25519 SPKI PEM the broker will pin.
 * @throws On absent, wrongly owned, or non-canonical key material.
 */
export declare function requireTerminalPublicKey(plan: CustodyPairPlan): string

/**
 * Return one canonical Ed25519 public PEM, refusing anything else.
 *
 * @param pem Candidate PEM text.
 * @param path Path reported in the refusal.
 * @returns The same PEM, once it is canonical Ed25519 SPKI.
 * @throws On unreadable, non-Ed25519, or non-canonical key material.
 */
export declare function canonicalTerminalPublicKey(pem: string, path: string): string

/**
 * Require the retained activation statement under exact root custody and
 * require it to measure the implementation this installer staged.
 *
 * @param plan Validated custody-pair plan.
 * @returns The verified activation digest.
 * @throws On an absent, wrongly owned, or unmeasured statement.
 */
export declare function requireActivationStatement(plan: CustodyPairPlan): string
