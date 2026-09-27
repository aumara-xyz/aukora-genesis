/** Stable names for principal-owned custody-helper refusals. */
export declare const CUSTODY_CHILD_REFUSE: Readonly<{
  ARGUMENTS_NOT_EXACT: 'launchd-custody-child:arguments-not-exact'
  OPERATION_UNKNOWN: 'launchd-custody-child:operation-unknown'
  PATH_NOT_ABSOLUTE: 'launchd-custody-child:path-not-absolute'
  PATH_NOT_NORMALIZED: 'launchd-custody-child:path-not-normalized'
  POSIX_IDENTITY_UNAVAILABLE: 'launchd-custody-child:posix-identity-unavailable'
  NOFOLLOW_UNAVAILABLE: 'launchd-custody-child:nofollow-unavailable'
  PROVISION_AS_ROOT: 'launchd-custody-child:provision-as-root'
  KEY_PARENT_UNSAFE: 'launchd-custody-child:key-parent-unsafe'
  KEY_STATE_UNOBSERVABLE: 'launchd-custody-child:key-state-unobservable'
  KEY_STATE_MALFORMED: 'launchd-custody-child:key-state-malformed'
  KEY_OWNER_MISMATCH: 'launchd-custody-child:key-owner-mismatch'
  KEY_MODE_UNSAFE: 'launchd-custody-child:key-mode-unsafe'
  KEY_PUBLICATION_FAILED: 'launchd-custody-child:key-publication-failed'
  KEY_CLEANUP_INDETERMINATE: 'launchd-custody-child:key-cleanup-indeterminate'
  BROKER_IDENTITY_FAILED: 'launchd-custody-child:broker-identity-failed'
  FILE_PROBE_FAILED: 'launchd-custody-child:file-probe-failed'
  SOCKET_PROBE_FAILED: 'launchd-custody-child:socket-probe-failed'
  INTERNAL_FAILURE: 'launchd-custody-child:internal-failure'
}>

/** An expected helper refusal with a stable machine-readable reason. */
export declare class CustodyChildError extends Error {
  readonly reason: string
  constructor(reason: string, detail: string)
}

/** Validate one exact lexical path. */
export declare function exactAbsolutePath(value: unknown): string

/** Create or load the issuer key and return only its public half. */
export declare function provisionIssuerKey(path: string): { rootPublicKeyPem: string }

/** Create or load the broker receipt identity and return only public data. */
export declare function provisionBroker(path: string): {
  brokerPublicKeyPem: string
  receiptKeyId: string
}

/** Attempt one no-follow read-only open without reading file contents. */
export declare function probeFileAccess(path: string): { opened: boolean, errno: string | null }

/** Attempt one Unix-socket connection and wait for the handle to close. */
export declare function probeSocketAccess(path: string): Promise<{ connected: boolean, errno: string | null }>
