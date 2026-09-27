/**
 * Serve the production broker with authenticated terminal review in its own
 * process. The transport uses role `broker` and a ceiling of 25 seconds,
 * shorter than the broker child's 35-second parent-IPC review deadline.
 * Issuer authorization, grants, settlement, and shutdown remain broker-owned.
 * The installer owns UID and socket-directory custody; this adapter proves none.
 */
import { BROKER_REFUSE, serve } from '../aukora/broker/broker.mjs'
import { createReviewTransportServer } from './launchd-review-transport.mjs'

/**
 * Bind terminal review, then serve a broker using the validated launch options.
 * Startup failure closes the review listener. Closing aborts outstanding review,
 * awaits broker quiescence and closes the terminal listener, retaining all errors.
 * @param {import('./launchd-broker-review.mjs').TerminalReviewedBrokerOptions} options broker configuration and pinned terminal route
 * @returns {Promise<import('../aukora/broker/broker.mjs').BrokerServer>} idempotently closable broker and review listener
 */
export async function serveBrokerWithTerminalReview({ broker, review }) {
  const transport = await createReviewTransportServer({ ...review, role: 'broker' })
  let server
  try {
    server = await serve({ ...broker, review: async (request, signal) => {
      try {
        return await transport.requestReview(request, signal)
      } catch (error) {
        if (signal.aborted) throw new Error(BROKER_REFUSE.STOPPING)
        if (error?.message === 'aukora:review-transport:timed-out') throw new Error(BROKER_REFUSE.REVIEW_TIMED_OUT)
        throw new Error(BROKER_REFUSE.REVIEW_CHANNEL_UNAVAILABLE, { cause: error })
      }
    } })
  } catch (error) {
    try { await transport.close() }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'launchd-broker-review:startup-cleanup-failed') }
    throw error
  }
  let closing
  return {
    close() {
      closing ??= (async () => {
        const outcomes = await Promise.allSettled([server.close(), transport.close()])
        const errors = outcomes.filter(outcome => outcome.status === 'rejected').map(outcome => outcome.reason)
        if (errors.length > 0) throw new AggregateError(errors, 'launchd-broker-review:close-failed')
      })()
      return closing
    },
  }
}
