/** J1's existing count requirement; neither labels nor counts attest PID/UID binding. */
export declare function principalJobCountsMatch(
  principalCount: number,
  principalLabels: readonly string[],
  accountDefinitions: readonly string[],
): boolean

/** An explicitly staged substring-only claim, separate from the real launchctl inventory. */
export declare function substringJobCounterfeit(
  platform: string,
  observedLabels: readonly string[],
  principals: readonly string[],
): { claimedLabels: string[]; claimedPrincipalLabels: string[]; detected: boolean }
