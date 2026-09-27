// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Provider-selection policy — FAIL-CLOSED.
 *
 * Chooses which BrainProvider the organism uses. It can select a verified small local / Nebius router LATER,
 * but it fails closed to the deterministic offline provider whenever a verified, checksum-bound model artifact
 * is not present and fully wired. No path here grants authority; every provider is advisory only.
 *
 * The Nebius branch is taken ONLY when ALL hold: a verified checksum-bound artifact exists; a valid, enabled,
 * fully-bound runtime manifest whose model checksum is in the verified inventory; an injected transport; and
 * env-present credentials. Any gap ⇒ deterministic offline. This round the verified inventory is empty
 * (`models/ARTIFACT_INVENTORY.md`), so selection is always deterministic-offline.
 */
import { type BrainProvider, DeterministicOfflineProvider } from './brainProvider.js';
import {
  NebiusBrainProvider,
  validateNebiusManifest,
  type NebiusDeploymentManifest,
  type NebiusCredentials,
  type NebiusTransport,
} from './nebiusProvider.js';

const HEX64 = /^[0-9a-f]{64}$/;

/** A model artifact that is actually reachable AND checksum-bound (an inventory entry). */
export interface VerifiedArtifact {
  readonly id: string;
  readonly modelChecksumSha256: string;
}

export interface NebiusWiring {
  readonly manifest: NebiusDeploymentManifest;
  readonly credentials: () => NebiusCredentials | null;
  readonly transport?: NebiusTransport;
}

export interface ProviderSelectionInput {
  readonly verifiedArtifacts: readonly VerifiedArtifact[];
  readonly nebius?: NebiusWiring;
}

export interface ProviderSelection {
  readonly provider: BrainProvider;
  readonly selection: 'deterministic-offline' | 'nebius';
  readonly reason: string;
  /** Structurally false — selecting a provider never grants authority. */
  readonly grantsAuthority: false;
}

function offline(reason: string): ProviderSelection {
  return { provider: new DeterministicOfflineProvider(), selection: 'deterministic-offline', reason, grantsAuthority: false };
}

/** Fail-closed provider selection. Returns the safe deterministic offline provider unless every gate passes. */
export function selectBrainProvider(input: ProviderSelectionInput): ProviderSelection {
  const verified = input.verifiedArtifacts.filter((a) => HEX64.test(a.modelChecksumSha256));
  if (verified.length === 0) return offline('fail-closed: no verified checksum-bound model artifact reachable');

  const n = input.nebius;
  if (!n) return offline('fail-closed: verified artifact present but no Nebius runtime configured');

  const violations = validateNebiusManifest(n.manifest);
  if (violations.length > 0) return offline(`fail-closed: invalid runtime manifest: ${violations.join(',')}`);
  if (!n.manifest.enabled) return offline('fail-closed: Nebius runtime not enabled (parked)');
  if (!verified.some((a) => a.modelChecksumSha256 === n.manifest.modelChecksumSha256)) {
    return offline('fail-closed: enabled runtime model checksum not in the verified inventory');
  }
  if (!n.transport) return offline('fail-closed: no Nebius transport injected');
  if (n.credentials() === null) return offline('fail-closed: no env-injected credentials');

  return {
    provider: new NebiusBrainProvider(n.manifest, n.credentials, n.transport),
    selection: 'nebius',
    reason: 'verified checksum-bound artifact + valid enabled bound runtime + transport + credentials',
    grantsAuthority: false,
  };
}

/** Selecting a provider grants no authority. Constant. */
export function providerSelectionGrantsAuthority(): false {
  return false;
}
