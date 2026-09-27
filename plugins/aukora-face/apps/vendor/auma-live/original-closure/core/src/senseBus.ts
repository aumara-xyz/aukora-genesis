import { createHash } from 'crypto';
import type { RestingGlyphProjection, GlyphMode, GlyphSceneTelemetry } from './restingGlyph';
import { containsForbiddenFields } from './restingGlyph';
import type { QuorumStatus } from './fusionConfig';

// ── Sense modalities ──

export type SenseModality = 'text' | 'voice' | 'glyph' | 'fusion' | 'receipt' | 'vision_stub';

// ── Voice evidence (amplitude only — no transcript authority) ──

export interface VoiceEvidenceFrame {
  modality: 'voice';
  amplitude: number;
  isSpeaking: boolean;
  isSilent: boolean;
  durationMs: number;
  transcript: string | null;
  transcriptTrusted: false;
  advisoryOnly: true;
  grantsAuthority: false;
}

// ── Text prompt evidence ──

export interface TextEvidenceFrame {
  modality: 'text';
  hasPrompt: boolean;
  promptLength: number;
  scanLabel: string | null;
  advisoryOnly: true;
  grantsAuthority: false;
}

// ── Glyph presence (current projection summary) ──

export interface GlyphPresenceFrame {
  modality: 'glyph';
  mode: GlyphMode;
  mood: GlyphSceneTelemetry['mood'];
  confidence: number;
  shadowActions: string[];
  directionCount: number;
  projectionHash: string;
  advisoryOnly: true;
  grantsAuthority: false;
}

// ── Fusion pressure ──

export interface FusionPressureFrame {
  modality: 'fusion';
  quorumStatus: QuorumStatus | null;
  lastSweepAge: number | null;
  adapterFailureCount: number;
  advisoryOnly: true;
  grantsAuthority: false;
}

// ── Receipt heartbeat ──

export interface ReceiptHeartbeatFrame {
  modality: 'receipt';
  chainLength: number;
  lastReceiptAge: number | null;
  testCount: number;
  testsPassing: boolean;
  advisoryOnly: true;
  grantsAuthority: false;
}

// ── Vision stub (future) ──

export interface VisionStubFrame {
  modality: 'vision_stub';
  available: false;
  reason: string;
  advisoryOnly: true;
  grantsAuthority: false;
}

// ── Union type ──

export type SenseFrame =
  | VoiceEvidenceFrame
  | TextEvidenceFrame
  | GlyphPresenceFrame
  | FusionPressureFrame
  | ReceiptHeartbeatFrame
  | VisionStubFrame;

// ── Duplex turn state ──

export type DuplexPhase =
  | 'resting'
  | 'listening'
  | 'interruption_possible'
  | 'processing'
  | 'speaking'
  | 'holding'
  | 'muted'
  | 'blocked';

export type PresenceAction =
  | 'settle'
  | 'respond'
  | 'retrieve'
  | 'hold'
  | 'ask_clarifying'
  | 'refuse';

export interface DuplexTurnState {
  phase: DuplexPhase;
  action: PresenceAction;
  reason: string;
  settleWindowMs: number;
  advisoryOnly: true;
  grantsAuthority: false;
}

// ── Shear observation ──

export interface ShearObservation {
  userSignalStrength: number;
  glyphProjectionConfidence: number;
  mismatch: number;
  surpriseLevel: number;
  settleRequired: boolean;
  advisoryOnly: true;
  grantsAuthority: false;
}

// ── Predictive presence (JEPA scaffold) ──

export interface PredictivePresenceState {
  predictedMode: GlyphMode;
  predictedMood: GlyphSceneTelemetry['mood'];
  predictedConfidence: number;
  observedMode: GlyphMode | null;
  observedMood: GlyphSceneTelemetry['mood'] | null;
  observedConfidence: number | null;
  surprise: number;
  predictionHash: string;
  advisoryOnly: true;
  grantsAuthority: false;
}

// ── Sense bus snapshot ──

export interface SenseBusSnapshot {
  timestamp: string;
  frames: SenseFrame[];
  duplexState: DuplexTurnState;
  shear: ShearObservation;
  predictiveState: PredictivePresenceState;
  snapshotHash: string;
  advisoryOnly: true;
  grantsAuthority: false;
}

// ── Builders ──

export function buildVoiceFrame(input: {
  amplitude: number;
  isSpeaking: boolean;
  durationMs: number;
  transcript?: string | null;
}): VoiceEvidenceFrame {
  return {
    modality: 'voice',
    amplitude: Math.max(0, Math.min(1, input.amplitude)),
    isSpeaking: input.isSpeaking,
    isSilent: input.amplitude < 0.01 && !input.isSpeaking,
    durationMs: input.durationMs,
    transcript: input.transcript ?? null,
    transcriptTrusted: false,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

export function buildTextFrame(input: {
  hasPrompt: boolean;
  promptLength: number;
  scanLabel?: string | null;
}): TextEvidenceFrame {
  return {
    modality: 'text',
    hasPrompt: input.hasPrompt,
    promptLength: input.promptLength,
    scanLabel: input.scanLabel ?? null,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

export function buildGlyphFrame(projection: RestingGlyphProjection): GlyphPresenceFrame {
  return {
    modality: 'glyph',
    mode: projection.mode,
    mood: projection.sceneTelemetry.mood,
    confidence: projection.sceneTelemetry.confidence,
    shadowActions: [...projection.shadowDecision.actions],
    directionCount: projection.researchDirections.length,
    projectionHash: projection.projectionHash,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

export function buildFusionFrame(input: {
  quorumStatus: QuorumStatus | null;
  lastSweepAge: number | null;
  adapterFailureCount: number;
}): FusionPressureFrame {
  return {
    modality: 'fusion',
    quorumStatus: input.quorumStatus,
    lastSweepAge: input.lastSweepAge,
    adapterFailureCount: input.adapterFailureCount,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

export function buildReceiptFrame(input: {
  chainLength: number;
  lastReceiptAge: number | null;
  testCount: number;
  testsPassing: boolean;
}): ReceiptHeartbeatFrame {
  return {
    modality: 'receipt',
    chainLength: input.chainLength,
    lastReceiptAge: input.lastReceiptAge,
    testCount: input.testCount,
    testsPassing: input.testsPassing,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

export function buildVisionStub(): VisionStubFrame {
  return {
    modality: 'vision_stub',
    available: false,
    reason: 'vision not yet implemented — hearing before sight',
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

// ── Duplex turn logic ──

export function buildDuplexTurnState(input: {
  voiceFrame: VoiceEvidenceFrame | null;
  textFrame: TextEvidenceFrame | null;
  glyphFrame: GlyphPresenceFrame;
  shear: ShearObservation;
}): DuplexTurnState {
  const { voiceFrame, textFrame, glyphFrame, shear } = input;

  if (glyphFrame.shadowActions.includes('should_refuse_prompt')) {
    return { phase: 'blocked', action: 'refuse', reason: 'safety: should_refuse_prompt', settleWindowMs: 0, advisoryOnly: true, grantsAuthority: false };
  }

  if (glyphFrame.shadowActions.includes('should_hold')) {
    return { phase: 'holding', action: 'hold', reason: 'shadow decision: should_hold', settleWindowMs: 0, advisoryOnly: true, grantsAuthority: false };
  }

  if (voiceFrame && voiceFrame.amplitude < 0.01 && !voiceFrame.isSpeaking && !textFrame?.hasPrompt) {
    return { phase: 'resting', action: 'settle', reason: 'no active input', settleWindowMs: 0, advisoryOnly: true, grantsAuthority: false };
  }

  if (voiceFrame && voiceFrame.isSpeaking) {
    if (shear.settleRequired) {
      return { phase: 'listening', action: 'settle', reason: 'high shear — settle before response', settleWindowMs: Math.round(shear.mismatch * 2000), advisoryOnly: true, grantsAuthority: false };
    }
    return { phase: 'listening', action: 'settle', reason: 'user speaking', settleWindowMs: 500, advisoryOnly: true, grantsAuthority: false };
  }

  if (textFrame && textFrame.hasPrompt) {
    if (shear.surpriseLevel > 0.7) {
      return { phase: 'processing', action: 'ask_clarifying', reason: `high surprise (${shear.surpriseLevel.toFixed(2)}) — clarify intent`, settleWindowMs: 1000, advisoryOnly: true, grantsAuthority: false };
    }
    if (shear.settleRequired) {
      return { phase: 'processing', action: 'settle', reason: 'shear mismatch — settle', settleWindowMs: Math.round(shear.mismatch * 1500), advisoryOnly: true, grantsAuthority: false };
    }
    if (glyphFrame.shadowActions.includes('should_run_fusion_review')) {
      return { phase: 'processing', action: 'retrieve', reason: 'fusion review needed', settleWindowMs: 300, advisoryOnly: true, grantsAuthority: false };
    }
    return { phase: 'processing', action: 'respond', reason: 'prompt ready', settleWindowMs: 200, advisoryOnly: true, grantsAuthority: false };
  }

  if (voiceFrame && voiceFrame.amplitude > 0.01 && !voiceFrame.isSpeaking) {
    return { phase: 'interruption_possible', action: 'settle', reason: 'ambient audio detected', settleWindowMs: 300, advisoryOnly: true, grantsAuthority: false };
  }

  return { phase: 'resting', action: 'settle', reason: 'default resting', settleWindowMs: 0, advisoryOnly: true, grantsAuthority: false };
}

// ── Shear observation ──

export function computeShearObservation(input: {
  userSignalStrength: number;
  glyphConfidence: number;
  predictedConfidence: number;
  predictedMode: GlyphMode;
  observedMode: GlyphMode;
}): ShearObservation {
  const signalStrength = Math.max(0, Math.min(1, input.userSignalStrength));
  const confidence = Math.max(0, Math.min(1, input.glyphConfidence));

  const modeMismatch = input.predictedMode !== input.observedMode ? 0.5 : 0;
  const confidenceDelta = Math.abs(input.predictedConfidence - confidence);
  const mismatch = Math.min(1, modeMismatch + confidenceDelta + Math.abs(signalStrength - confidence) * 0.3);
  const surpriseLevel = Math.min(1, modeMismatch * 1.5 + confidenceDelta * 0.8);
  const settleRequired = mismatch > 0.4;

  return {
    userSignalStrength: signalStrength,
    glyphProjectionConfidence: confidence,
    mismatch,
    surpriseLevel,
    settleRequired,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

// ── JEPA-style predictive presence (deterministic scaffold) ──

export function predictNextVisibleState(input: {
  currentMode: GlyphMode;
  currentMood: GlyphSceneTelemetry['mood'];
  currentConfidence: number;
  hasVoiceInput: boolean;
  hasTextInput: boolean;
  fusionQuorum: QuorumStatus | null;
}): { predictedMode: GlyphMode; predictedMood: GlyphSceneTelemetry['mood']; predictedConfidence: number; predictionHash: string } {
  let mode: GlyphMode = input.currentMode;
  let mood: GlyphSceneTelemetry['mood'] = input.currentMood;
  let confidence = input.currentConfidence;

  if (input.hasVoiceInput && input.currentMode === 'resting') {
    mode = 'listening';
    mood = 'curious';
    confidence = Math.min(1, confidence + 0.1);
  } else if (input.hasTextInput && input.currentMode === 'resting') {
    mode = 'reviewing';
    mood = 'thinking';
    confidence = Math.min(1, confidence + 0.05);
  } else if (input.hasTextInput && input.currentMode === 'listening') {
    mode = 'reviewing';
    mood = 'thinking';
  } else if (!input.hasVoiceInput && !input.hasTextInput && input.currentMode === 'listening') {
    mode = 'resting';
    mood = 'calm';
    confidence = Math.max(0, confidence - 0.05);
  } else if (!input.hasVoiceInput && !input.hasTextInput && input.currentMode === 'reviewing') {
    mode = 'resting';
    mood = 'calm';
  }

  if (input.fusionQuorum === 'RED_QUORUM' || input.fusionQuorum === 'NO_QUORUM') {
    mood = 'alert';
    confidence = Math.max(0, confidence - 0.1);
  } else if (input.fusionQuorum === 'YELLOW_QUORUM') {
    mood = mood === 'calm' ? 'curious' : mood;
  }

  const predictionHash = hashPrediction(mode, mood, confidence);

  return { predictedMode: mode, predictedMood: mood, predictedConfidence: Math.round(confidence * 100) / 100, predictionHash };
}

export function comparePredictedToObserved(
  predicted: { predictedMode: GlyphMode; predictedMood: GlyphSceneTelemetry['mood']; predictedConfidence: number },
  observed: { mode: GlyphMode; mood: GlyphSceneTelemetry['mood']; confidence: number },
): { surprise: number; modeMismatch: boolean; moodMismatch: boolean; confidenceDelta: number } {
  const modeMismatch = predicted.predictedMode !== observed.mode;
  const moodMismatch = predicted.predictedMood !== observed.mood;
  const confidenceDelta = Math.abs(predicted.predictedConfidence - observed.confidence);
  const surprise = Math.min(1, (modeMismatch ? 0.4 : 0) + (moodMismatch ? 0.3 : 0) + confidenceDelta * 0.5);

  return { surprise, modeMismatch, moodMismatch, confidenceDelta };
}

export function computePresenceSurprise(
  predicted: { predictedMode: GlyphMode; predictedMood: GlyphSceneTelemetry['mood']; predictedConfidence: number; predictionHash: string },
  observed: { mode: GlyphMode; mood: GlyphSceneTelemetry['mood']; confidence: number },
): PredictivePresenceState {
  const comparison = comparePredictedToObserved(predicted, observed);

  return {
    predictedMode: predicted.predictedMode,
    predictedMood: predicted.predictedMood,
    predictedConfidence: predicted.predictedConfidence,
    observedMode: observed.mode,
    observedMood: observed.mood,
    observedConfidence: observed.confidence,
    surprise: comparison.surprise,
    predictionHash: predicted.predictionHash,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

// ── Snapshot builder ──

export function buildSenseBusSnapshot(input: {
  frames: SenseFrame[];
  glyphFrame: GlyphPresenceFrame;
  voiceFrame: VoiceEvidenceFrame | null;
  textFrame: TextEvidenceFrame | null;
  predictiveState: PredictivePresenceState;
}): SenseBusSnapshot {
  const shear = computeShearObservation({
    userSignalStrength: input.voiceFrame ? input.voiceFrame.amplitude : (input.textFrame?.hasPrompt ? 0.5 : 0),
    glyphConfidence: input.glyphFrame.confidence,
    predictedConfidence: input.predictiveState.predictedConfidence,
    predictedMode: input.predictiveState.predictedMode,
    observedMode: input.glyphFrame.mode,
  });

  const duplexState = buildDuplexTurnState({
    voiceFrame: input.voiceFrame,
    textFrame: input.textFrame,
    glyphFrame: input.glyphFrame,
    shear,
  });

  const snapshot: Omit<SenseBusSnapshot, 'snapshotHash'> = {
    timestamp: new Date().toISOString(),
    frames: input.frames,
    duplexState,
    shear,
    predictiveState: input.predictiveState,
    advisoryOnly: true,
    grantsAuthority: false,
  };

  const snapshotHash = createHash('sha256')
    .update(JSON.stringify(snapshot))
    .digest('hex');

  return { ...snapshot, snapshotHash };
}

// ── Validation ──

export function validateSenseBusSnapshot(snapshot: SenseBusSnapshot): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  if (snapshot.advisoryOnly !== true) violations.push('snapshot.advisoryOnly must be true');
  if ((snapshot as any).grantsAuthority !== false) violations.push('snapshot.grantsAuthority must be false');
  if (!snapshot.snapshotHash) violations.push('snapshotHash missing');
  if (!snapshot.duplexState) violations.push('duplexState missing');
  if (snapshot.duplexState && snapshot.duplexState.advisoryOnly !== true) violations.push('duplexState.advisoryOnly must be true');
  if (snapshot.duplexState && (snapshot.duplexState as any).grantsAuthority !== false) violations.push('duplexState.grantsAuthority must be false');
  if (snapshot.shear && snapshot.shear.advisoryOnly !== true) violations.push('shear.advisoryOnly must be true');
  if (snapshot.predictiveState && snapshot.predictiveState.advisoryOnly !== true) violations.push('predictiveState.advisoryOnly must be true');

  for (const frame of snapshot.frames) {
    if (frame.advisoryOnly !== true) violations.push(`frame[${frame.modality}].advisoryOnly must be true`);
    if ((frame as any).grantsAuthority !== false) violations.push(`frame[${frame.modality}].grantsAuthority must be false`);
  }

  const forbidden = containsForbiddenFields(snapshot);
  for (const f of forbidden) violations.push(`forbidden field: ${f}`);

  return { valid: violations.length === 0, violations };
}

// ── Internal helpers ──

function hashPrediction(mode: GlyphMode, mood: GlyphSceneTelemetry['mood'], confidence: number): string {
  return createHash('sha256')
    .update(`${mode}:${mood}:${confidence.toFixed(4)}`)
    .digest('hex');
}
