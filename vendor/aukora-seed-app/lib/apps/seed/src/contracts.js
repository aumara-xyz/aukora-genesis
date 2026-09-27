// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * @aukora/seed/contracts — the DISPLAY/CONSUMER contract surface for Sam 4 (console/shell) and other read-only lanes.
 *
 * STRICTLY TYPE-ONLY: every re-export below is `export type`, so importing this module pulls in ZERO runtime code —
 * no owner gate, no signer fixture, no recursion orchestrator, no ceremony. A consumer can render every governed
 * surface (ceremony views, AURA geometry, traces, receipts, constitution state, selection plans, runner decisions)
 * without the POSSIBILITY of touching authority code, because none exists in this module's import closure at runtime.
 *
 * The only values exported are frozen string literals naming the schemas — declared LOCALLY so even they import nothing.
 */
// ── schema names (local literals; import nothing) ──────────────────────────
export const CONTRACT_SCHEMAS = Object.freeze({
    ceremonyView: 'aukora-ceremony-view-v1',
    ceremonyOutcome: 'aukora-ceremony-outcome-v1',
    geometry: 'aukora-aura-geometry-v1',
    spatialSnapshot: 'aukora-spatial-ceremony-snapshot-v1',
    spatialShellFace: 'aukora-spatial-shell-face-v1',
    constitutionView: 'aukora-constitution-view-v1',
    maternalAnchor: 'aukora-maternal-anchor-v1',
    selectionPacket: 'aukora-memory-selection-packet-v1',
    routingPlan: 'aukora-selection-routing-plan-v1',
    receiptView: 'aukora-receipt-view-v1',
    councilPack: 'aukora-council-evidence-pack-v1',
    brokerRef: 'aukora-broker-ref-v1',
    workflow: 'aukora-recursion-workflow-v1',
});
/** The contract surface is display/consumption only — it can never mint authority. Constant, by construction. */
export const CONTRACTS_GRANT_AUTHORITY = false;
