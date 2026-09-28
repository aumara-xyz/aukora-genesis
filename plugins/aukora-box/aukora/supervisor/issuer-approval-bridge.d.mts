/** Issuer prompt framing over explicit owner-controlled streams and lifetime events. */
import type { EventEmitter } from 'node:events'
import type { Readable, Writable } from 'node:stream'
import type { DeveloperLaunchError } from './developer-launch-error.mjs'

/** Complete issuer-rendered frame through its fresh approval challenge. */
export interface DeveloperIssuerApprovalRequest {
  readonly challenge: string
  readonly prompt: string
  /** Present only when the issuer renders an AUTHORIZE DIGEST frame. */
  readonly authorizationDigest?: string
}

/** Unavailable sends no answer and leaves the issuer's own deadline active. */
export type DeveloperIssuerApprovalDecision = 'approved' | 'denied' | 'unavailable'

/** Decide one exact issuer prompt; throws and unrecognized results fail the assembly. */
export type DeveloperIssuerApproval = (
  request: Readonly<DeveloperIssuerApprovalRequest>,
  signal: AbortSignal,
) => Promise<DeveloperIssuerApprovalDecision> | DeveloperIssuerApprovalDecision

/** Stream adapter emits exit or close when its issuer connection ends. */
export interface IssuerApprovalStreams extends Pick<EventEmitter, 'once' | 'removeListener'> {
  readonly stdin: Writable
  readonly stderr: Readable
  readonly exitCode?: number | null
  readonly signalCode?: NodeJS.Signals | null
}

/**
 * Forward bounded issuer frames; only explicit approved or denied decisions write stdin.
 * Exit, close, or stream teardown aborts active review and discards queued prompts.
 * The sink receives raw, unvalidated bytes and must not present them as approved content.
 * @param child - Owner-controlled issuer streams and lifetime events.
 * @param approve - Reviewer of one complete prompt; must honor cancellation.
 * @param sink - Synchronous raw diagnostic consumer, not an authorization renderer.
 * @param failAssembly - Owner that stops the assembly after a framing or callback error.
 * @returns No value; issuer lifetime owns listener cleanup.
 */
export declare function installIssuerApprovalBridge(
  child: IssuerApprovalStreams,
  approve: DeveloperIssuerApproval,
  sink: (text: string) => void,
  failAssembly: (error: DeveloperLaunchError) => void,
): void
