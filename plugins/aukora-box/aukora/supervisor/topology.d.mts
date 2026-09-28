export type TopologyPrincipalName = 'human-session' | 'issuer' | 'broker' | 'guest'

export interface TopologyServiceName {
  account: string
  jobLabel: string
}

export interface TopologyRouteName {
  group: string
  directoryPath: string
  socketPath: string
}

export interface TopologyProtectedPath {
  kind:
    | 'socket-root'
    | 'root-key'
    | 'receipt-key'
    | 'nonce-state'
    | 'evidence'
    | 'active-profile'
    | 'active-artifact'
    | 'implementation-closure'
    | 'guest-scratch'
  path: string
}

export interface TopologyManifest {
  schema: 'aukora:launch-topology:v1'
  platform: 'darwin' | 'linux'
  humanSession: {
    source: 'invoking-process-user'
    approvalJobLabel: string
  }
  services: Record<'issuer' | 'broker' | 'guest', TopologyServiceName>
  routes: Record<'humanIssuer' | 'brokerIssuer' | 'guestBroker', TopologyRouteName>
  protectedPaths: TopologyProtectedPath[]
}

export interface AccountObservation {
  account: string
  uid: number
  gid: number
  groups: Array<{ name: string; gid: number }>
}

export interface JobObservation {
  label: string
  pid: number
  uid: number
}

export interface PathObservation {
  path: string
  type: 'directory' | 'file' | 'socket' | 'symlink' | 'other' | 'unobservable'
  uid: number | null
  gid: number | null
  mode: number | null
}

export interface TopologyRefusal {
  reason: string
  subject: string
  detail: string
}

export type TopologyVerificationBlocker =
  | 'supervisor:active-probes-not-run'
  | 'supervisor:closure-members-unmeasured'
  | 'supervisor:runtime-path-binding-unmeasured'
  | 'supervisor:route-membership-closure-unmeasured'
  | 'supervisor:peer-authentication-unmeasured'
  | 'supervisor:extended-acls-unmeasured'
  | 'supervisor:observer-privilege-unresolved'

export interface TopologyObservation {
  schema: 'aukora:topology-observation:v1'
  status: 'UNVERIFIED' | 'REFUSED'
  configurationMatched: boolean
  observationClass: 'CONFIGURATION_ONLY'
  factsSource: 'live-os'
  activationPerformed: false
  hostMutationPerformed: false
  separationVerified: false
  verificationBlockers: TopologyVerificationBlocker[]
  platform: string
  observer: {
    source: 'invoking-process-user'
    uid: number
    privilegeClass: 'PRIVILEGED' | 'UNPRIVILEGED'
    serviceStateTraversalClaimed: false
  }
  humanSession: AccountObservation
  principals: Record<TopologyPrincipalName, AccountObservation | null>
  jobs: Partial<Record<TopologyPrincipalName, JobObservation | null>>
  routes: Record<string, {
    group: string
    groupGid: number | null
    directory: PathObservation | null
    socket: PathObservation | null
  }>
  protectedPaths: Record<string, PathObservation | null>
  refusals: TopologyRefusal[]
}

export interface TopologyInputRefusal {
  schema: 'aukora:topology-input-refusal:v1'
  status: 'REFUSED'
  configurationMatched: false
  observationClass: 'INPUT_ONLY'
  factsSource: 'none'
  activationPerformed: false
  hostMutationPerformed: false
  separationVerified: false
  verificationBlockers: TopologyVerificationBlocker[]
  refusals: TopologyRefusal[]
}

export interface TopologyObservationFailure {
  schema: 'aukora:topology-observation-failure:v1'
  status: 'REFUSED'
  configurationMatched: false
  observationClass: 'OBSERVATION_ATTEMPT'
  factsSource: 'live-os-attempted'
  activationPerformed: false
  hostMutationPerformed: false
  separationVerified: false
  verificationBlockers: TopologyVerificationBlocker[]
  refusals: TopologyRefusal[]
}

export declare const TOPOLOGY_MANIFEST_SCHEMA: 'aukora:launch-topology:v1'
export declare const TOPOLOGY_OBSERVATION_SCHEMA: 'aukora:topology-observation:v1'
export declare const TOPOLOGY_INPUT_REFUSAL_SCHEMA: 'aukora:topology-input-refusal:v1'
export declare const TOPOLOGY_OBSERVATION_FAILURE_SCHEMA: 'aukora:topology-observation-failure:v1'
export declare const TOPOLOGY_VERIFICATION_BLOCKERS: readonly TopologyVerificationBlocker[]

export declare class TopologyManifestError extends Error {
  readonly reason: string
  readonly subject: string
  constructor(reason: string, subject: string, detail: string)
}

export declare function parseTopologyManifest(input: string | Buffer | unknown): TopologyManifest

export declare function topologyDisposition(refusals: readonly TopologyRefusal[]): {
  status: 'REFUSED' | 'UNVERIFIED'
  configurationMatched: boolean
}

export declare function topologyCliExitCode(status: 'REFUSED' | 'UNVERIFIED'): 1 | 2

export declare function inspectTopology(input: string | Buffer | unknown): TopologyObservation
