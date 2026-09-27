/** The topology court's count-based job evidence and explicitly staged label counterfeit. */

/**
 * Apply J1's existing label/account-definition counts without treating a name as an account.
 * These counts are not a PID-to-launchd-job or UID binding attestation.
 * @param {number} principalCount - Number of required principals.
 * @param {readonly string[]} principalLabels - Observed labels naming a principal.
 * @param {readonly string[]} accountDefinitions - Observed job definitions setting UserName.
 * @returns {boolean} whether both required counts match.
 */
export function principalJobCountsMatch(principalCount, principalLabels, accountDefinitions) {
  return principalLabels.length === principalCount
    && accountDefinitions.length === principalCount
}

/**
 * Stage labels claiming every principal but supplying no account definitions.
 * Real loaded labels remain input evidence, never replaced by the staged claim.
 * Linux retains the enrolled unavailable-launchd counterfactual result.
 * @param {string} platform - Host platform reported by Node.
 * @param {readonly string[]} observedLabels - Unmodified read-only launchctl inventory.
 * @param {readonly string[]} principals - Required principal names.
 * @returns {{claimedLabels: string[], claimedPrincipalLabels: string[], detected: boolean}} the counterfeit and its verdict.
 */
export function substringJobCounterfeit(platform, observedLabels, principals) {
  const claimedPrincipalLabels = principals.map(principal => `court.aukora.${principal === 'human' ? 'supervisor' : principal}`)
  const claimedLabels = [...new Set([...observedLabels, ...claimedPrincipalLabels])]
  const substringSaysDeployed = claimedLabels.some(label => /aukora/i.test(label))
  const detected = platform === 'darwin' && substringSaysDeployed
    && !principalJobCountsMatch(principals.length, claimedPrincipalLabels, [])
  return { claimedLabels, claimedPrincipalLabels, detected }
}
