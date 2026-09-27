interface DirectoryIdentity {
  readonly uid: number
  readonly gid: number
  readonly dev: number
  readonly ino: number
  readonly mode: number
}

interface FileIdentity {
  readonly uid: string
  readonly gid: string
  readonly dev: string
  readonly ino: string
  readonly mode: string
  readonly nlink: string
  readonly size: string
  readonly mtimeNs: string
  readonly ctimeNs: string
}

/** Exact readonly observation; it carries neither an approval nor private file contents. */
export interface WebRecoveryInspection {
  readonly dataDir: string
  readonly dataIdentity: DirectoryIdentity
  readonly stateDir: string
  readonly expectedHead: string
  readonly inspection: Readonly<Record<string, unknown>>
  readonly lease: { readonly pid: number; readonly startedAt: number; readonly identity: FileIdentity; readonly sha256: string }
  readonly retained: { readonly head: string; readonly entries: number }
  readonly rows: ReadonlyArray<({ readonly path: string; readonly kind: 'directory' } & DirectoryIdentity)
    | ({ readonly path: string; readonly kind: 'file'; readonly sha256: string } & FileIdentity)>
  readonly historicalVolumeIdentity: 'unverified'
  readonly issuerSignaturesVerified: false
  readonly brokerStarted: false
}

/**
 * Inspect existing history, a dead writer lease and a device-only seal mismatch without writes.
 * @param options - Canonical data directory and the operator's prior Aura head.
 * @returns Exact metadata to present for terminal approval; no issuer or volume-identity verification.
 */
export function inspectWebRecovery(options: { dataDir: string; expectedHead: string }): WebRecoveryInspection

/**
 * Back up all state, archive the dead lease and repair the seal under the real writer lease.
 * @param plan - Unchanged inspection explicitly approved by the calling operator interface.
 * @returns Offline measurements; never a broker launch or live-recall claim.
 */
export function recoverWebStore(plan: WebRecoveryInspection): {
  status: 'WEB_STORE_RECOVERED'
  backupDir: string
  sealBackupDir: string
  sealSha256: string
  leaseArchived: true
  retained: { head: string; entries: number }
  activationUnchanged: true
  brokerStarted: false
  liveRecall: false
  historicalVolumeIdentity: 'unverified'
  issuerSignaturesVerified: false
}
