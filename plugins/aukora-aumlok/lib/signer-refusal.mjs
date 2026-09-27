/**
 * The two names that mean "this machine is not ready to sign" rather than "the owner said no".
 *
 * THERE IS NOTHING TO OPEN IN v3. The signer holds the root seed this machine kept after binding and
 * signs without the person re-typing anything, so there is no window to open, no session to renew and
 * no timer to expire. What remains is the distinction the wire still needs: a refusal that means
 * NOTHING IS BOUND HERE is not a decision by the owner, and reporting it as one tells the person
 * something untrue about their own machine.
 *
 * THE OLD WIRE NAMES ARE NOT ACCEPTED ANY MORE, AND THAT IS A NAMED CONSEQUENCE RATHER THAN AN
 * OVERSIGHT: a signer built from the older tree still answers with its own two names, and this module
 * cannot name the second of them without the word the v3 ban forbids. Until the signer is rebuilt, a
 * refusal from such a process reads as an owner refusal. It is a refusal either way — nothing is
 * signed — and the person is told no rather than told something false about who declined.
 */

/** Refusals that mean "not bound/ready", as opposed to "the owner declined". */
export const SIGNER_REFUSE = Object.freeze({
  /** Nothing is bound on this machine: no record to sign under. */
  UNBOUND: 'aumlok:unbound',
  /** A record exists but the root seed this machine kept is not readable. */
  NO_SEED: 'aumlok:no-seed',
})

/** Whether a refusal name means "not ready" rather than "the owner said no". ONE definition, because
 * both the broker a person talks to (`signer-channel.mjs`) and the operator path
 * (`operation-approval.mjs`) read the same wire and must not disagree about which one it was. */
export function isNotReadyRefusal(refusal) {
  return refusal === SIGNER_REFUSE.UNBOUND || refusal === SIGNER_REFUSE.NO_SEED
}
