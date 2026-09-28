/** Stable names for persisted activation-binding refusal reasons. */
export type ActivationStateRefuseKey = 'MALFORMED' | 'CONFLICT'

/** Stable names for check-at-use admission verdicts. */
export type ActivationAdmitRefuseKey = 'STATE_MALFORMED' | 'MISMATCH' | 'STALE' | 'UNBOUND'

export declare const ACTIVATION_ADMIT_REFUSE: Readonly<Record<ActivationAdmitRefuseKey, string>>

export declare function admitActivation(facts: {
  expected: string | null
  persisted: string | null
  presented: string | null | undefined
}): { ok: true } | { ok: false; reason: string; detail: string }

export declare const ACTIVATION_BINDING_DOMAIN: 'aukora:activation-binding:v1'
export declare const ACTIVATION_STATE_REFUSE: Readonly<Record<ActivationStateRefuseKey, string>>

export declare class ActivationStateError extends Error {
  constructor(reason: string, detail: string)
  readonly reason: string
}

export declare function activationBindingPath(stateDir: string): string
export declare function readActivationBinding(stateDir: string): string | null
export declare function bindActivation(stateDir: string, digest: unknown): string
