/**
 * The approval occurrence channel: at most one artifact is visible for
 * approval at a time, and every answer names the occurrence and the artifact
 * digest it answers.
 *
 * Binding the answer to both is what stops an answer meant for one prompt
 * settling another. An answer that names no active occurrence, a different
 * occurrence, or a different artifact is refused rather than applied to
 * whatever happens to be open.
 *
 * Every path except one exact match is a refusal. `APPROVED` is the only
 * outcome {@link isSigningOutcome} admits, so a new outcome added without a
 * decision about signing fails closed instead of reaching a signature.
 *
 * @module @aukora/approval/occurrence
 */
import {
  approvalArtifactDigest,
  approvalRefusalReason,
  parseApprovalArtifact,
} from './artifact.mjs'

/**
 * How long one occurrence stays answerable. A SECURITY INVARIANT, not a
 * deployment tunable: it bounds how long the single approval slot can be held
 * against every other request, and a caller able to lengthen it could starve
 * the channel.
 */
export const APPROVAL_OCCURRENCE_DEADLINE_MS = 30_000

/** Challenge values are 8 random bytes, lowercase hex. */
const CHALLENGE = /^[0-9a-f]{16}$/u

/**
 * What actually happened at one occurrence. A boolean cannot carry this: a
 * deadline passing, a carrier disconnecting, and a human typing the wrong
 * answer are three different events and only one of them is a decision.
 */
export const APPROVAL_OUTCOME = Object.freeze({
  APPROVED: 'approved',
  DENIED: 'denied',
  TIMED_OUT: 'timed-out',
  CANCELLED: 'cancelled',
})

/** Named refusals raised when an answer cannot be applied to any occurrence. */
export const REFUSE_OCCURRENCE = Object.freeze({
  BUSY: 'approval:occurrence-busy',
  NONE_ACTIVE: 'approval:no-active-occurrence',
  MISMATCH: 'approval:occurrence-mismatch',
  ARTIFACT_MUTATED: 'approval:artifact-mutated',
  CHALLENGE_MALFORMED: 'approval:challenge-malformed',
})

/**
 * Whether one outcome may reach a signature. EXHAUSTIVE over
 * {@link APPROVAL_OUTCOME}: an unrecognised value throws rather than
 * defaulting either way, so a future outcome cannot silently become signable.
 * @param {string} outcome - one {@link APPROVAL_OUTCOME} value.
 * @returns {boolean} true only for an explicit human approval.
 * @throws {TypeError} when the outcome is not a known member.
 */
export function isSigningOutcome(outcome) {
  switch (outcome) {
    case APPROVAL_OUTCOME.APPROVED: return true
    case APPROVAL_OUTCOME.DENIED:
    case APPROVAL_OUTCOME.TIMED_OUT:
    case APPROVAL_OUTCOME.CANCELLED: return false
    default: throw new TypeError(`approval:outcome-unknown (${String(outcome)})`)
  }
}

/**
 * Create one approval channel.
 *
 * The channel holds no timer. Expiry is evaluated against the injected clock
 * whenever the channel is used, so a caller cannot answer a lapsed occurrence
 * by winning a race with a callback.
 * @param {{now?: () => number}} [options] - clock seam; defaults to `Date.now`.
 * @returns {{open: (input: {artifact: unknown, challenge: string}) => {ok: true, occurrence: Readonly<{occurrenceId: string, artifactDigest: string, challenge: string, openedAt: number}>} | {ok: false, reason: string}, submit: (input: {occurrenceId: unknown, artifactDigest: unknown, answer: unknown}) => {ok: true, outcome: string} | {ok: false, reason: string}, cancel: (outcome?: string) => boolean, active: () => Readonly<{occurrenceId: string, artifactDigest: string, challenge: string, openedAt: number}> | null}} the channel.
 */
export function createApprovalChannel({ now = Date.now } = {}) {
  /** @type {{occurrenceId: string, artifactDigest: string, challenge: string, expectedAnswer: string, openedAt: number} | null} */
  let current = null

  const publicView = () => (current === null ? null : Object.freeze({
    occurrenceId: current.occurrenceId,
    artifactDigest: current.artifactDigest,
    challenge: current.challenge,
    openedAt: current.openedAt,
  }))

  /** Close a lapsed occurrence before any answer is considered against it. */
  const expireIfDue = () => {
    if (current !== null && now() - current.openedAt > APPROVAL_OCCURRENCE_DEADLINE_MS) current = null
  }

  return {
    open({ artifact, challenge }) {
      if (typeof challenge !== 'string' || !CHALLENGE.test(challenge)) {
        return { ok: false, reason: REFUSE_OCCURRENCE.CHALLENGE_MALFORMED }
      }
      expireIfDue()
      if (current !== null) return { ok: false, reason: REFUSE_OCCURRENCE.BUSY }
      let parsed
      try {
        parsed = parseApprovalArtifact(artifact)
      } catch (error) {
        return { ok: false, reason: approvalRefusalReason(error) }
      }
      current = {
        occurrenceId: parsed.occurrenceId,
        artifactDigest: approvalArtifactDigest(parsed),
        challenge,
        expectedAnswer: `yes ${challenge}`,
        openedAt: now(),
      }
      return { ok: true, occurrence: /** @type {NonNullable<ReturnType<typeof publicView>>} */ (publicView()) }
    },

    submit({ occurrenceId, artifactDigest, answer }) {
      expireIfDue()
      // A pre-prompt answer, an answer after a decision, and an answer after a
      // restart all arrive with no occurrence open. They share one refusal
      // because they are the same fact: nothing is being asked.
      if (current === null) return { ok: false, reason: REFUSE_OCCURRENCE.NONE_ACTIVE }
      if (occurrenceId !== current.occurrenceId) return { ok: false, reason: REFUSE_OCCURRENCE.MISMATCH }
      if (artifactDigest !== current.artifactDigest) return { ok: false, reason: REFUSE_OCCURRENCE.ARTIFACT_MUTATED }
      // The occurrence is spent by the decision, not by its result: a denial
      // consumes it exactly as an approval does, so a second answer cannot
      // revisit it.
      const approved = typeof answer === 'string' && answer === current.expectedAnswer
      current = null
      return { ok: true, outcome: approved ? APPROVAL_OUTCOME.APPROVED : APPROVAL_OUTCOME.DENIED }
    },

    cancel(outcome = APPROVAL_OUTCOME.CANCELLED) {
      if (isSigningOutcome(outcome)) throw new TypeError('approval:cancel-outcome-invalid')
      if (current === null) return false
      current = null
      return true
    },

    active() {
      expireIfDue()
      return publicView()
    },
  }
}
