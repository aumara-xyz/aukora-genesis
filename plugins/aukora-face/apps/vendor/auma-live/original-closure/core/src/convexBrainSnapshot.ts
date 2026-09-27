// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * Convex Brain Snapshot — host-agnostic, read-only.
 *
 * The seed states a CLEAN read-only Convex posture: it inventories NO host/private topology, names NO
 * research lanes, mounts NO donor backend, and exposes NO write/executor/production path. Convex is
 * read-only unless a separately-built, tested, signed apply lane exists. (Replaced the old aukora-os
 * topology inventory — that named private lanes the seed must not carry.) ADVISORY: grants no authority.
 */
export type ConvexBridgeMode = 'static_inventory' | 'local_loopback_readonly' | 'missing';
export type ConvexOrganSourceKind = 'runtime_candidate' | 'donor_only' | 'lab_only' | 'stale' | 'forbidden' | 'future';

export interface ConvexOrganSurface {
  name: string;
  path: string;
  category: string;          // generic — the seed enumerates NO host topology categories
  status: string;
  safeToExposeToWomb: boolean;
  runtimeImportAllowed: boolean;
  reason: string;
  hasTest: boolean;
  sourceRepo: string;        // generic — no host/donor repo named
  sourceKind: ConvexOrganSourceKind;
  fileCount: number;
  testCount: number;
}

export interface ConvexBrainStatus {
  schemaFound: boolean;
  tableCount: number;
  testFileCount: number;
  loopbackAvailable: boolean;
  localOrganismAvailable: boolean;
}

export interface ConvexBrainSnapshot {
  bridgeMode: ConvexBridgeMode;
  advisoryOnly: true;
  grantsAuthority: false;
  activeCandidateCount: number;
  readOnlyCandidateCount: number;
  labOnlyCount: number;
  staleCount: number;
  forbiddenCount: number;
  futureCount: number;
  donorCount: number;
  sourceRepos: string[];
  organs: ConvexOrganSurface[];
  brainStatus: ConvexBrainStatus;
  risks: string[];
  nextSafeWiringStep: string;
  timestamp: string;
}

// Defensive: fields that must NEVER appear in a snapshot (secrets, signed heads, model state, URLs).
const FORBIDDEN_SNAPSHOT_FIELDS = new Set([
  'apiKey', 'api_key', 'privateKey', 'private_key',
  'seed', 'secretSeed', 'pop', 'proofOfPossession',
  'signedHead', 'signed_head', 'rawSignature', 'raw_signature',
  'kvCache', 'kv_cache', 'hiddenState', 'hidden_state',
  'rawActivations', 'raw_activations', 'privateSeed', 'private_seed',
  'modelWeights', 'model_weights', 'password', 'secret', 'token',
  'deploymentUrl', 'deployment_url', 'convexUrl', 'convex_url',
  'deploymentSlug', 'deployment_slug',
]);

export function validateSnapshot(snapshot: ConvexBrainSnapshot): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  if (snapshot.advisoryOnly !== true) violations.push('advisoryOnly must be true');
  if ((snapshot as { grantsAuthority?: unknown }).grantsAuthority !== false) violations.push('grantsAuthority must be false');
  if (!['static_inventory', 'local_loopback_readonly', 'missing'].includes(snapshot.bridgeMode)) {
    violations.push(`invalid bridgeMode: ${snapshot.bridgeMode}`);
  }

  function scanObj(obj: unknown, p: string): void {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (FORBIDDEN_SNAPSHOT_FIELDS.has(key)) violations.push(`forbidden field: ${p}.${key}`);
      if (typeof value === 'string' && (value.startsWith('sk-') || value.includes('CONVEX_URL') || /https:\/\/.*convex\.(cloud|dev|site)/.test(value))) {
        violations.push(`credential/cloud URL leak at ${p}.${key}`);
      }
      if (typeof value === 'object' && value !== null) scanObj(value, `${p}.${key}`);
    }
  }
  scanObj(snapshot, 'snapshot');

  // Host-agnostic: NO donor mandate, NO required source repos. A FORBIDDEN organ may never be importable.
  for (const organ of snapshot.organs) {
    if (organ.status === 'FORBIDDEN' && organ.runtimeImportAllowed) {
      violations.push(`FORBIDDEN organ ${organ.name} marked runtimeImportAllowed`);
    }
  }

  return { valid: violations.length === 0, violations };
}

/**
 * Build a host-agnostic, read-only snapshot. The seed mounts NO live brain by default and inventories
 * NO host topology — it reports a clean read-only posture. `repoRoot` is accepted for API compatibility
 * but no host tree is scanned.
 */
export function buildConvexBrainSnapshot(repoRoot?: string): ConvexBrainSnapshot {
  void repoRoot;
  const snapshot: ConvexBrainSnapshot = {
    bridgeMode: 'missing',
    advisoryOnly: true,
    grantsAuthority: false,
    activeCandidateCount: 0,
    readOnlyCandidateCount: 0,
    labOnlyCount: 0,
    staleCount: 0,
    forbiddenCount: 0,
    futureCount: 0,
    donorCount: 0,
    sourceRepos: [],
    organs: [],
    brainStatus: { schemaFound: false, tableCount: 0, testFileCount: 0, loopbackAvailable: false, localOrganismAvailable: false },
    risks: ['No live brain is mounted in the seed; the read-only receiver connects loopback-only when available and never mutates.'],
    nextSafeWiringStep: 'Read-only receiver only. A signed apply lane is a separate, tested, future brick — never a default.',
    timestamp: new Date().toISOString(),
  };
  return snapshot;
}
