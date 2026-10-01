import { NOSTR_SAFETY_VERSION, SAS_CONFIRMATION_DOMAIN } from './airlock-witness.mjs'

export const AIRLOCK_PROTOCOL_VERSION = 2
export const airlockProtocolRequest = challenge => ({ kind: 'protocol',
  protocolVersion: AIRLOCK_PROTOCOL_VERSION, safetyVersion: NOSTR_SAFETY_VERSION,
  confirmationDomain: SAS_CONFIRMATION_DOMAIN, challenge })

// A public capability proof is distinct from an approval or identity signing preimage.
export function airlockProtocolPreimage(challenge) {
  if (typeof challenge !== 'string' || !/^[0-9a-f]{64}$/u.test(challenge)) {
    throw new Error('signer:request-malformed')
  }
  return Buffer.from(`aukora:airlock-protocol:v1\n${AIRLOCK_PROTOCOL_VERSION}\n${NOSTR_SAFETY_VERSION}\n${SAS_CONFIRMATION_DOMAIN}\n${challenge}`, 'utf8')
}
