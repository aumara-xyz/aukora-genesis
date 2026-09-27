const HEX64 = /^[0-9a-f]{64}$/;
/** The read-only 32B gate. ALL elements present and well-formed ⇒ AVAILABLE_PRIVATE; else UNVERIFIED_OR_PARKED. */
export function verify32bClaim(evidence) {
    const missing = [];
    if (!evidence.license)
        missing.push('license');
    if (!evidence.modelChecksumSha256 || !HEX64.test(evidence.modelChecksumSha256))
        missing.push('model_checksum');
    if (!evidence.codeSha256 || !HEX64.test(evidence.codeSha256))
        missing.push('code_digest');
    if (!evidence.imageDigestSha256 || !HEX64.test(evidence.imageDigestSha256))
        missing.push('image_digest');
    if (!evidence.runnableManifestSha256 || !HEX64.test(evidence.runnableManifestSha256))
        missing.push('runnable_manifest');
    if (!evidence.evalEvidenceSha256 || !HEX64.test(evidence.evalEvidenceSha256))
        missing.push('eval_evidence');
    return { truth: missing.length === 0 ? 'AVAILABLE_PRIVATE' : 'UNVERIFIED_OR_PARKED', missing, launched: false, paidInference: false };
}
/**
 * Assign brain roles from the verification result. The 32B becomes remote primary voice/routing ONLY when its
 * verification passed; otherwise the assignment fails closed to deterministic-offline. The small local vision
 * fallback is OPTIONAL (kept when `localVisionAvailable`), always advisory, never primary authority of any kind.
 */
export function assignBrainRoles(v, localVisionAvailable) {
    const fallbacks = localVisionAvailable ? ['local-vision-fallback', 'deterministic-offline'] : ['deterministic-offline'];
    if (v.truth === 'AVAILABLE_PRIVATE') {
        return { primary: 'remote-primary-voice-routing', fallbacks, reason: 'verified: license + checksum + digests + runnable manifest + eval evidence', grantsAuthority: false };
    }
    return { primary: 'deterministic-offline', fallbacks, reason: `fail-closed: 32B unverified (missing: ${v.missing.join(',') || 'none'})`, grantsAuthority: false };
}
/** Role assignment grants no authority. Constant. */
export function brainRolesGrantAuthority() {
    return false;
}
