/** The content-free provenance stamped over an untrusted (capability-less) open ingest. */
export const UNTRUSTED_PROVENANCE = 'untrusted-external';
/** `owner-only` is the OWNER-TRUST claim — the only scope a public caller may not forge without a capability. */
export function consentRequiresCapability(consent) {
    return consent === 'owner-only';
}
/**
 * Qualify a public ingest by its self-attested `consent` and whether the caller presented a valid capability.
 * A valid capability (the trusted door) preserves the full attestation. Without it: `owner-only` is REFUSED;
 * `private`/`shared` are admitted with the scope preserved but the self-attested provenance quarantined; an
 * unknown/malformed consent falls back to `shared` (fail-closed).
 */
export function qualifyMemoryIngest(input) {
    if (input.capabilityValid)
        return { decision: 'accept-trusted' };
    if (input.consent === 'owner-only')
        return { decision: 'refuse', reasonClass: 'owner-only-ingest-requires-capability' };
    const scope = input.consent === 'private' || input.consent === 'shared' ? input.consent : 'shared';
    return { decision: 'quarantine', consent: scope, provenance: UNTRUSTED_PROVENANCE };
}
/** HARD: qualification grants no authority — it only refuses or downgrades an untrusted self-attestation. */
export function ingestGateGrantsAuthority() {
    return false;
}
