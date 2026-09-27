/** Signal-zero observations do not establish broker identity or authorize lease removal. */
export interface KiraRecoveryInspection {
  schema: 'aukora:kira-recovery-inspection:v1'
  stateDir: string
  observationClass: 'SAME_UID_ADVISORY / NOT_RELEASE_AUTHORITY'
  storeVerified: false
  releaseAllowed: false
  status: 'lease-absent' | 'pid-present' | 'pid-not-observed' | 'undetermined'
  reason: string
  lease: { pid: number; startedAt: number; sha256: string; dev: string; ino: string } | null
  process: { status: 'occupied' | 'not-observed'; reason: string; identity: 'unverified' } | null
}

/**
 * Read only the bounded lease metadata and signal-zero process observation.
 * @param stateDir - Canonical absolute broker state directory.
 * @returns Observations, never a release authorization or a store verification.
 */
export function inspectKiraRecovery(stateDir: string): KiraRecoveryInspection
