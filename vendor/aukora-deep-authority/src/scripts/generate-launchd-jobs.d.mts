/** Stable refusal names. Callers match on these values, never on message prose. */
export declare const LAUNCHD_REFUSE: {
  readonly INPUTS_UNREADABLE: 'launchd:inputs-unreadable'
  readonly INPUTS_NOT_PLAIN: 'launchd:inputs-not-plain'
  readonly FIELD_MISSING: 'launchd:field-missing'
  readonly FIELD_UNKNOWN: 'launchd:field-unknown'
  readonly FIELD_NOT_STRING: 'launchd:field-not-string'
  readonly FIELD_XML_UNSAFE: 'launchd:field-xml-unsafe'
  readonly FIELD_PLACEHOLDER_UNSAFE: 'launchd:field-placeholder-unsafe'
  readonly PATH_NOT_ABSOLUTE: 'launchd:path-not-absolute'
  readonly PATH_NOT_NORMALIZED: 'launchd:path-not-normalized'
  readonly LABEL_UNSAFE: 'launchd:label-unsafe'
  readonly LABELS_COLLAPSE: 'launchd:labels-collapse'
  readonly PRINCIPALS_COLLAPSE: 'launchd:principals-collapse'
  readonly GROUPS_COLLAPSE: 'launchd:groups-collapse'
  readonly SOCKET_PARENTS_COLLAPSE: 'launchd:socket-parents-collapse'
  readonly PUBLIC_KEY_INVALID: 'launchd:public-key-invalid'
  readonly MEMORY_CONFIGURATION_INVALID: 'launchd:memory-configuration-invalid'
  readonly IMPLEMENTATION_INSIDE_CHECKOUT: 'launchd:implementation-inside-checkout'
  readonly SECRET_INSIDE_CHECKOUT: 'launchd:secret-inside-checkout'
  readonly STATE_INSIDE_CHECKOUT: 'launchd:state-inside-checkout'
  readonly KEY_READABLE_BY_BROKER: 'launchd:key-readable-by-broker'
  readonly PLACEHOLDER_UNRESOLVED: 'launchd:placeholder-unresolved'
  readonly TEMPLATE_MISSING: 'launchd:template-missing'
  readonly PLIST_INVALID: 'launchd:plist-invalid'
  readonly OUTPUT_DIR_UNSAFE: 'launchd:output-dir-unsafe'
  readonly OUTPUT_EXISTS: 'launchd:output-exists'
  readonly OUTPUT_WRITE_FAILED: 'launchd:output-write-failed'
  readonly OUTPUT_ROLLBACK_INDETERMINATE: 'launchd:output-rollback-indeterminate'
}

/** Host-specific values required to generate the two LaunchDaemon jobs. */
export interface LaunchdInputs {
  brokerLabel: string
  brokerUser: string
  brokerGroup: string
  brokerSocket: string
  brokerStateDir: string
  brokerPublicKeyPem: string
  rootPublicKeyPem: string
  issuerLabel: string
  issuerUser: string
  issuerGroup: string
  issuerSocket: string
  issuerStateDir: string
  issuerKeyFile: string
  implementationRoot: string
  nodeBin: string
  /** Route the broker publishes for the terminal review transport. */
  reviewSocket: string
  /** File holding the terminal's Ed25519 public key in PEM form. */
  reviewTerminalPublicKeyFile: string
  /** Server identity the terminal pins when it authenticates to that route. */
  reviewServerId: string
  /** Retained activation statement the broker measures itself against. */
  activationStatementFile: string
  /** Activation digest the job carries; the statement must measure to it. */
  activationDigest: string
  /** Trusted renderer identity recorded in the activation. */
  rendererId: string
  /** Explicit JSON recall policy; requires the complete memory bundle. */
  kiraRecallPolicy?: string
  /** Canonical Base64 session-to-agent authority; requires the complete memory bundle. */
  subjectAuthority?: string
  /** Operator-controlled public control-state file; requires the complete memory bundle. */
  rootControlStateFile?: string
  /** Optional operator-owned prompt transport; requires issuerApprovalSocketUid. */
  issuerApprovalSocket?: string
  /** Canonical decimal owner uid; requires issuerApprovalSocket. */
  issuerApprovalSocketUid?: string
}

/** Validated inputs plus the receipt-key identity derived from the broker key. */
export interface ValidatedLaunchdInputs extends LaunchdInputs {
  expectedReceiptKeyId: string
}

/** A refusal carrying a stable name. */
export declare class LaunchdGenerateError extends Error {
  constructor(reason: string, detail: string)
  readonly reason: string
}

export declare function isInside(candidate: string, root: string): boolean
export declare function validateInputs(raw: unknown, repoDir: string): ValidatedLaunchdInputs
/** Validate a complete optional memory bundle, preserving the explicit strings. */
export declare function validateMemoryLaunchInputs(inputs: Record<string, unknown>): Readonly<Record<string, string>>
/** Validate both optional issuer transport fields without authorizing a prompt. */
export declare function validateApprovalLaunchInputs(inputs: Record<string, unknown>): Readonly<Record<string, string>>
export declare function renderTemplate(
  template: string,
  inputs: ValidatedLaunchdInputs,
): string
export declare function renderJobs(
  inputs: ValidatedLaunchdInputs,
): { broker: string, issuer: string }
export declare function lintJobs(jobs: { broker: string, issuer: string }): void
export declare function writeExclusiveJobs(
  outDir: string,
  inputs: ValidatedLaunchdInputs,
  jobs: { broker: string, issuer: string },
): string[]
export declare function checkReport(
  inputs: ValidatedLaunchdInputs,
  repoDir?: string,
): Record<string, string | boolean>
