// SPDX-License-Identifier: AGPL-3.0-or-later
import type { OwnerPolicy } from './disclosure.ts'

interface OrganismDisclosureDependencies {
  readonly disclosurePolicy: () => OwnerPolicy
  readonly disclosureRecipient: string
  readonly organismLens?: () => Promise<string>
  readonly organismStateLens?: () => Promise<string>
}

/** Select optional organism context before any read; engine admission still governs every disclosure. */
export function organismDisclosureDependencies(
  dependencies: OrganismDisclosureDependencies,
): OrganismDisclosureDependencies {
  const permitted = () => {
    const policy = dependencies.disclosurePolicy()
    return policy.recipient !== ''
      && policy.recipient === dependencies.disclosureRecipient
      && policy.allowed.includes('organism-state')
  }
  const guard = (read: () => Promise<string>) => async () => {
    // Outside the lens cache: neither a fresh read nor a cached result bypasses a revocation.
    if (!permitted()) return ''
    const text = await read()
    // A policy edit while an asynchronous read was in flight also takes effect before returning its text.
    return permitted() ? text : ''
  }
  return {
    // Policy forwarding is independent of both organism permission and the configured home.
    disclosurePolicy: dependencies.disclosurePolicy,
    disclosureRecipient: dependencies.disclosureRecipient,
    ...(dependencies.organismLens === undefined ? {} : { organismLens: guard(dependencies.organismLens) }),
    ...(dependencies.organismStateLens === undefined ? {} : { organismStateLens: guard(dependencies.organismStateLens) }),
  }
}
