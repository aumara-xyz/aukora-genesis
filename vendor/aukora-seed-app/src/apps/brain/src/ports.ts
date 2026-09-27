// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * NEW-AUKORA service ports — the brain block (R37).
 *
 * Collision-free by design: the donor Symbiote stack owns 7090–7093 (spatial/door/voice/arc3 — NEVER reused as
 * new services; see apps/console/scripts/launch.mjs RESERVED), and the local Convex backend owns its upstream
 * defaults 3210 (deployment) / 3211 (site proxy), loopback dev-only. The NEW brain claims the 7140–7149 block:
 *
 *   7141  brain projection/control door (loopback HTTP — src/localDoor.ts)
 *   7142  keychain loopback broker (contract default — src/keychain/credentialStore.ts)
 *   7143–7149  reserved for future brain-lane services (unassigned)
 *
 * Every service in this block binds 127.0.0.1 ONLY.
 */
export const AUKORA_PORTS = {
  brainDoor: 7141,
  keychainBroker: 7142,
  spatialShell: 7096,   // the new organism's Spatial shell (apps/spatial; reads the 7141 door)
  mindDoor: 7097,       // the governed mind/chat door (apps/seed)
  voiceSidecar: 7098,   // optional voice sidecar (no standalone server on this tree yet)
  convexLocalDeployment: 3210, // upstream default, dev-only, loopback
  convexLocalSite: 3211,       // upstream default, dev-only, loopback
  donorReserved: [7090, 7091, 7092, 7093], // Symbiote spatial/door/voice/arc3 — never reuse as new services
} as const;
