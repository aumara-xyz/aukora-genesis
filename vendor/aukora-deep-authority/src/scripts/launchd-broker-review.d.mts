import type { BrokerServer, serve } from '../aukora/broker/broker.mjs'
import type { ReviewServerOptions } from './launchd-review-transport.mjs'

/** Validated installer inputs; terminal review replaces only the broker's review callback. */
export interface TerminalReviewedBrokerOptions {
  broker: Omit<Parameters<typeof serve>[0], 'review'>
  /** Public terminal key and protected route; the transport role is fixed to `broker`. */
  review: Omit<ReviewServerOptions, 'role'>
}

/**
 * Serve one same-process broker and terminal review listener with a maximum
 * 25-second review wait. No issuer approval or installed-UID proof is supplied.
 * @param options Validated broker configuration and installer-pinned review route.
 * @returns A broker whose idempotent close awaits both listeners and active work.
 * @throws On startup or cleanup failure; concurrent cleanup failures are aggregated.
 */
export declare function serveBrokerWithTerminalReview(options: TerminalReviewedBrokerOptions): Promise<BrokerServer>
