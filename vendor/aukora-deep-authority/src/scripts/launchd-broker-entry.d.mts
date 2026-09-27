import type { BrokerServer } from '../aukora/broker/broker.mjs'
import type { TerminalReviewedBrokerOptions } from './launchd-broker-review.mjs'

/** Refusal reasons raised before any listener binds. */
export declare const BROKER_ENTRY_REFUSE: Readonly<{
  BROKER_ENVIRONMENT_INCOMPLETE: string
  REVIEW_ROUTE_REQUIRED: string
  TERMINAL_KEY_UNREADABLE: string
  ACTIVATION_REQUIRED: string
  MEMORY_CONFIGURATION_INCOMPLETE: string
}>

/**
 * Read the installed broker's launch options from a launchd environment.
 *
 * The review route is required: an installed broker that started without one
 * could only run unreviewed, so a missing route refuses rather than degrades.
 * @param environment Process environment supplied by the loaded launchd job.
 * @returns Broker configuration and the pinned terminal review route.
 * @throws On incomplete broker environment, missing review route, or an unreadable terminal key.
 */
export declare function readEntryOptions(environment: NodeJS.ProcessEnv): TerminalReviewedBrokerOptions

/**
 * Serve the installed broker with terminal review, stopping on SIGTERM/SIGINT.
 * @param environment Process environment supplied by the loaded launchd job.
 * @returns A broker whose idempotent close awaits both listeners.
 * @throws On any refusal from `readEntryOptions` or on startup failure.
 */
export declare function main(environment?: NodeJS.ProcessEnv): Promise<BrokerServer>
