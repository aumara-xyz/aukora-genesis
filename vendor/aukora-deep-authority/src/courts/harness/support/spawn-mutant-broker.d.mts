import type { ChildProcess } from 'node:child_process'

export declare function spawnMutantBroker(options: {
  entry: string
  socketPath: string
  stateDir: string
  rootPublicKeyPem: string
  issuerSocket?: string
  review?: (
    request: object,
    signal: AbortSignal,
  ) => Promise<'approved' | 'denied'> | 'approved' | 'denied'
  env?: Record<string, string | undefined>
  peerTokenPath?: string
  peerTokenSha256?: string
  activationDigest?: string
  rendererId?: string
  skipScrub?: boolean
  timeoutMs?: number
}): Promise<ChildProcess>
