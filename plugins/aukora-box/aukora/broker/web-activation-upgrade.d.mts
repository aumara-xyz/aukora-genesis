import type { WebActivationUpgrade } from '../activation/web-upgrade-record.mjs'
import type { WebActivationRollback } from '../activation/web-rollback-record.mjs'

export interface WebActivationUpgradeSession {
  readonly operation: Readonly<WebActivationUpgrade>
  readonly previousBinding: string
  commit(record: unknown): Readonly<{
    status: 'ACTIVATION_UPGRADED'
    previousActivation: string
    activationDigest: string
    storeDigest: string
  }>
  close(): void
}

export declare function beginWebActivationUpgrade(
  stateDir: string,
  nextInput: unknown,
  options?: { readonly expectedPreviousActivation?: string },
): WebActivationUpgradeSession

export interface WebActivationRollbackSession {
  readonly operation: Readonly<WebActivationRollback>
  commit(): Readonly<{
    status: 'ACTIVATION_ROLLED_BACK'
    activationDigest: string
    storeDigest: string
    auditPath: string
  }>
  close(): void
}

export declare function beginWebActivationRollback(stateDir: string, bundleInput: unknown): WebActivationRollbackSession
