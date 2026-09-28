import type { BrokerReviewRequest } from '../broker/broker.mjs'
import type { DeveloperIssuerApprovalRequest, DeveloperIssuerApprovalDecision } from './developer-launch.mjs'
import type { ReviewTransportClient, ReviewServerOptions } from '../../scripts/launchd-review-transport.mjs'

/** Public route bound to the unchanged AUMLOK controller. */
export interface WebReviewConfig extends ReviewServerOptions {
  subject: string
}

/** Two-stage review callbacks accepted by the existing assembly launcher. */
export interface WebReview {
  review(request: Readonly<BrokerReviewRequest>, signal: AbortSignal): Promise<'approved' | 'denied'>
  issuerApproval(request: DeveloperIssuerApprovalRequest, signal: AbortSignal): Promise<DeveloperIssuerApprovalDecision>
  close(): Promise<void>
}

/** Read an owner-managed 0600 JSON file in a canonical private directory. */
export declare function readWebReviewConfig(path: string): Readonly<WebReviewConfig>
/** Require the selected subject before publishing the review socket. */
export declare function createWebReview(config: WebReviewConfig, subject: string): Promise<WebReview>
/** Connect the terminal with its separate authentication key and the existing renderers. */
export declare function connectWebReview(config: WebReviewConfig, privateKeyPath: string): Promise<ReviewTransportClient>
/** Connect a non-terminal owner renderer using the same key and socket validation. */
export declare function connectWebReviewRenderer(config: WebReviewConfig, privateKeyPath: string,
  renderer: Pick<import('../../scripts/launchd-review-transport.mjs').ReviewClientOptions, 'review' | 'reviewIssuer'>): Promise<ReviewTransportClient>
/** Measured approval implementation for the reconnectable Web route. */
/**
 * Issuer-leg approval window in milliseconds. It must finish before the issuer bridge's
 * 25-second callback ceiling, so it is a security-relevant bound rather than a preference.
 * The owner UI imports it so the deadline it displays is this one, not a second copy.
 */
export declare const REVIEW_TIMEOUT_MS: number

/**
 * Broker-artifact approval window in milliseconds. Larger than the issuer leg because a
 * reader must take in a MEMORY.WRITE body before deciding, and nothing downstream of this
 * stage holds a signed deadline. Bounded by the broker's own IPC wait less five seconds.
 */
export declare const ARTIFACT_REVIEW_TIMEOUT_MS: number

export declare const WEB_REVIEW_RENDERER_ID: string
