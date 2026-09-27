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

// ── ceremony + display projections ─────────────────────────────────────────
export type { CeremonyView, ViewSafety } from './ceremonyView.js';
export type { CeremonyChallenge, CeremonyOutcome, CeremonyVerdict } from './ceremony.js';

// ── AURA geometry + trace (render-only shapes) ─────────────────────────────
export type { AuraGeometry, WitnessMode, GeometrySanitizeResult } from './geometry.js';
export type { RecursionTraceEvent, TraceTombstone, TracePhase, TraceReceiptMode, SanitizeResult } from './auraTrace.js';

// ── Spatial shell adapter (read-only face) ─────────────────────────────────
export type { SpatialCeremonySnapshot, SpatialShellFace, CeremonyEventRecord } from './spatialCeremonyAdapter.js';
export type { ReadOnlyEventStream, SpatialStreamContract } from './eventStream.js';

// ── memory constitution / anchor / selection ───────────────────────────────
export type { MemoryTier, ChangePath, ConstitutionView, GoldChangeRequest, GoldVerdict, GoldReasonClass } from './memoryConstitution.js';
export type { MaternalAnchorV1, AnchorQuality, AnchorResult } from './maternalAnchor.js';
export type { MemorySelectionPacketV1, SelectionItem, SelectionClass, SourceRowCitation } from './memorySelection.js';
export type { SelectionRoutingPlan, RoutedItem, SelectionRoute, AcceptanceReasonClass, AcceptanceResult } from './selectionAcceptance.js';

// ── IDE session evidence surfaces ──────────────────────────────────────────
export type { ReceiptView, ReceiptViewRow, RefusalLogEntry } from './ideSession.js';
export type { Refusal, IdeReasonClass, Citation, BranchCandidate, BranchCandidateFile } from './ideEnvelope.js';
export type { PathVerdict, PathClass, FenceReasonClass } from './pathFence.js';

// ── council evidence + runner boundary (decision shapes only) ──────────────
export type { CouncilEvidencePackV1, CouncilTestSummary } from './councilPack.js';
export type { RunnerDecision, RunnerAdmission, RunnerRefusal, RunnerReasonClass, BrokerRefV1, FuguReview } from './councilRunnerBoundary.js';

// ── durable workflow (Sam 2's Convex adapter implements WorkflowStore; states are projections only) ──
export type { WorkflowStateV1, WorkflowStore, WorkflowPhase, SaveResult, DurableOutcome, DurableReasonClass } from './durableRecursion.js';

// ── real Fu adapter + local candidate stage (result shapes only) ──
export type { FuAdvisoryResult, FuAdapterReasonClass, FuAdvisoryOpts } from './fuStructuredAdapter.js';
export type { CandidateMaterialization, CandidateReasonClass, MaterializeInput } from './localCandidateStage.js';

// ── R37 live runner + composed ceremony (config + result shapes; DI points, never a key) ──
export type { CredentialSource, ProviderTransportConfig, HttpPost, HttpResponse } from './providerTransport.js';
export type { CeremonyRunResult, CeremonyRunPhase, LocalCeremonyEnv, LocalCeremonyInvocation } from './localCeremonyRunner.js';
export type { LiveSmokeResult, LiveSmokeOptions } from './fuLiveSmoke.js';

// ── R38 governed chat/mind door (request/response + event shapes; no key/authority) ──
export type { DoorRequest, DoorResponse, DoorEvent, MindDoorConfig, DoorDriver, DoorDriverLoader } from './mindDoor.js';
export type { DoorGuardResult, DoorGuardReason, DoorGuardOptions } from './doorGuards.js';

// ── R39 canonical reference monitor + armed egress (decision + receipt shapes only) ──
export type { MonitorDecision } from './candidateReferenceMonitor.js';
export type { ProviderArm, EgressReceipt, ArmedEgressOptions } from './providerEgress.js';

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
} as const);

/** The contract surface is display/consumption only — it can never mint authority. Constant, by construction. */
export const CONTRACTS_GRANT_AUTHORITY = false as const;
