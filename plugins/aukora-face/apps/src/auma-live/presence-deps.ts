/**
 * THE ONE PLACE THE PRESENCE ENGINE'S DEPENDENCIES ARE ASSEMBLED.
 *
 * WHY THIS FUNCTION EXISTS, AND IT IS NOT TIDINESS. `http.ts` built its engine with thirteen hand-written
 * conditional spreads, and `presence.ts` reads two fields those spreads never mentioned — `organismLens` and
 * `claimsPacket`. So `index.ts` constructed both lenses, handed them to `AumaLiveHttp`, and the constructor
 * dropped them on the floor: **Auma has never seen the organism.** Nothing failed, because the fields were
 * also absent from `AumaLiveHttpDependencies`, so the type system had nothing to complain about. Two
 * interfaces drifted and no code compared them.
 *
 * **A SEAM IS WHAT MAKES THAT MEASURABLE.** A court cannot instantiate the engine without a running Host, so
 * the forwarding is a plain function over a plain object — the court calls it with sentinel lenses and asserts
 * they arrive BY IDENTITY. The alternative was to grep `http.ts` for the two names, and a grep is not a court:
 * it passes when the behaviour is gone and the words remain.
 *
 * A PLAIN `.js` MODULE SO THE COURT CAN IMPORT IT. The caller is TypeScript; this is not.
 *
 * @module presence-deps
 */

/**
 * The optional dependencies forwarded from the caller, unchanged. **ADD A FIELD HERE WHEN `PresenceDependencies`
 * GAINS ONE** — the court asserts this list against the interface's own declarations, so a field added to the
 * interface and forgotten here fails by name rather than silently going missing.
 */
const FORWARDED = Object.freeze([
  'reportRecordFailure',
  'repoLens', 'repoLensLookups',
  'webLens', 'webLensLookups',
  'recall', 'recallLookups',
  // **RECALL IS SCOPED TO THE OWNER'S OWN SESSION, SO THE HOME HAS TO REACH THE ENGINE.** A dependency declared but
  // not forwarded is a gate that never sees a home — and the lens court names exactly that, which is how this line
  // came to exist. Without it every session is "other" and recall is silently off everywhere.
  'homeSession',
  'weights', 'weightsVerbs',
  'organismLens', 'claimsPacket',
  // THE ORGANISM DOCUMENT TRAVELS THE SAME ROAD. A dependency declared but not forwarded reaches the engine as
  // undefined, and the lens is then silently absent — which is the failure this list exists to make impossible.
  'organismStateLens',
  // THE MONEY GATE IS A DEPENDENCY LIKE ANY OTHER. A deployment that sets a cap must have THAT cap reach the
  // engine, and a forwarded key is how every other injected dependency gets there.
  'spendGate',
  'kiraLens', 'kiraLookups',
  'coreLens', 'coreSessionConfigured', 'coreTasksPerTurn', 'coreDailyCap', 'sessionController', 'coreEvents',
  // **A DEPENDENCY DECLARED BUT NOT FORWARDED IS A CALLBACK THAT NEVER FIRES** — and this one failing silently is the
  // exact state auma-53 exists to end: KIRA's consumer has waited since kira-122 with nothing emitting. The court
  // beside this list asserts it against the interface's declarations, so this entry is checked rather than hoped for.
  'turnFinished',
  // **THE DISCLOSURE CHECKPOINT'S INPUTS.** Not forwarded, the engine has no policy and refuses every turn as `no-policy`.
  'providerSendConsent', 'disclosurePolicy', 'disclosureRecipient', 'onDisclosure', 'onDisclosureRefused',
])

/**
 * Assemble the engine's dependencies from what the caller supplied, plus what `http.ts` constructs itself.
 *
 * @param {Record<string, unknown>} supplied - the caller's dependencies (`AumaLiveHttpDependencies`)
 * @param {Record<string, unknown>} [constructed] - what `http.ts` builds itself, MERGED WHOLESALE
 * @returns {Record<string, unknown>} the object handed to `new PresenceEngine`
 */
export function presenceEngineDependencies(
  // **`object`, NOT `Record<string, unknown>`, AND THE DIFFERENCE IS NOT COSMETIC.** TypeScript gives an
  // INTERFACE no implicit index signature (only a type alias gets one), so declaring this as a Record makes
  // `AumaLiveHttpDependencies` — an interface — fail to be assignable to it, and every caller stops compiling
  // while the values are perfectly fine. The cast below is the one place that fact is acknowledged.
  supplied: object | undefined,
  // **AN OPEN RECORD, AND THAT IS THE POINT.** The first version named `minds` and `carriesPriorConversations`
  // and silently DROPPED `resolveApiKey` and `restoreRing` when this seam replaced the old hand-written spread —
  // the mind would have had no API-key resolution and no ring to restore, on every turn. A closed list here is
  // exactly how a dependency goes missing without anyone having to edit a list.
  constructed: { readonly [key: string]: unknown } = {},
): Record<string, unknown> {
  const bag = supplied as Record<string, unknown> | undefined
  const out: Record<string, unknown> = {}
  for (const key of FORWARDED) {
    // ABSENT STAYS ABSENT. An explicit `undefined` would be indistinguishable from a supplied value to a
    // reader of the resulting object, and a dependency that is present-but-undefined is how a lens that was
    // never wired looks exactly like one that was.
    if (bag?.[key] !== undefined) out[key] = bag[key]
  }
  for (const [key, value] of Object.entries(constructed)) {
    if (value !== undefined) out[key] = value
  }
  return out
}

/** The keys this module forwards. Exported so the court compares it against the interface rather than a copy. */
export const FORWARDED_DEPENDENCY_KEYS = FORWARDED
