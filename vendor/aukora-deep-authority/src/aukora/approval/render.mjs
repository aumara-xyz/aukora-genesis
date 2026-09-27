/**
 * Deterministic rendering of one approval artifact.
 *
 * The renderer re-derives the artifact before drawing it, so a caller cannot
 * verify one value and display another. Output is a pure function of the
 * artifact and the challenge: the same pair renders the same bytes on every
 * process and platform, which is what lets a court compare a rendered frame
 * against an expected one.
 *
 * Nothing here truncates. Every projection line the artifact carries is
 * drawn in full, and the artifact reader already bounds their number and
 * size, so an oversized operation refuses before it reaches a display rather
 * than arriving as an ellipsis the human would have to trust.
 *
 * @module @aukora/approval/render
 */
import { approvalArtifactDigest, parseApprovalArtifact } from './artifact.mjs'
import { definitionDigest, WORKSPACE_PATCH } from '../broker/effect-definition.mjs'

/** The frame's fixed width, in characters, excluding the leading gutter. */
const RULE = '-'.repeat(60)

/** Challenge values are 8 random bytes, lowercase hex. */
const CHALLENGE = /^[0-9a-f]{16}$/u

/**
 * Render one approval artifact as the exact frame a trusted renderer shows.
 *
 * The challenge appears only in the final line, and the artifact digest
 * appears inside the frame, so an answer quoting the challenge names the one
 * occurrence whose frame carried it.
 * @param {unknown} input - candidate artifact; re-derived before rendering.
 * @param {string} challenge - the fresh value first disclosed by this prompt.
 * @returns {string} the deterministic frame, without a trailing newline.
 * @throws {TypeError} a named approval refusal, or an invalid challenge.
 */
export function renderApprovalArtifact(input, challenge) {
  if (typeof challenge !== 'string' || !CHALLENGE.test(challenge)) {
    throw new TypeError('approval:challenge-malformed')
  }
  const artifact = parseApprovalArtifact(input)
  const digest = approvalArtifactDigest(artifact)
  const body = [
    artifact.definitionId === definitionDigest(WORKSPACE_PATCH)
      ? 'WORKSPACE.PATCH - approve this exact operation'
      : 'MEMORY.WRITE - approve this exact operation',
    '',
    ...artifact.semanticProjection,
    '',
    `activationDigest: ${artifact.activationDigest}`,
    `occurrenceId: ${artifact.occurrenceId}`,
    `rendererId: ${artifact.rendererId}`,
    `approvalArtifactDigest: ${digest}`,
  ].map((line) => `  | ${line}`).join('\n')
  return `  +- ${RULE}\n${body}\n  +- approve? type "yes ${challenge}": `
}
