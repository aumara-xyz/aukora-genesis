import type { ChildProcess } from 'node:child_process'

export declare const GUEST_CONFINEMENT_MODE: 'macos-seatbelt'
export declare const CONFINED_OBSERVATION_CLASS: 'MACOS_SEATBELT_GUEST / SAME_UID_AUTHORITIES / NO_CUSTODY_CLAIM'
export interface GuestConfinement {
  readonly text: string
  readonly sha256: string
  readonly scratch: string
  readonly cwd: string
  readonly brokerSocket: string
  readonly issuerSocket: string
  readonly issuerKey: string
  readonly stateDir: string
  readonly profileDir: string
}
export declare class GuestConfinementError extends Error {
  readonly reason: string
  constructor(reason: string, detail: string)
}
export declare function requireGuestConfinement(mode: string): void
export declare function prepareGuestConfinement(options: {
  root: string
  paths: Readonly<{ guestHome: string; activationHome: string; stateDir: string; brokerSocket: string; issuerSocket: string }>
  issuerKey: string
}): Readonly<GuestConfinement>
export declare function spawnConfinedGuest(policy: GuestConfinement, args: readonly string[], env: NodeJS.ProcessEnv): ChildProcess
export declare function verifyGuestConfinement(policy: GuestConfinement, env: NodeJS.ProcessEnv): Promise<void>
