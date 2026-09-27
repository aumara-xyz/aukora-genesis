// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Ports — the five structural contracts the pure mind reasons across (type-only, no I/O).
 *
 * The mind never owns an effect: the caller supplies an environment (Env), a model transport
 * (MindSocket), a replayable world for lookahead (Simulator), terminal signals, and episodic
 * notes. Everything here is a structural TypeScript type; nothing executes.
 *
 * Re-authored from the ARC-AGI-3 reasoning engine, aukora-symbiote branch
 * fable/arc3-reasoning-engine-20260710 @ e5768a2f.
 */

/** A color grid observation: rows of palette indices (0..15). */
export type Grid = ReadonlyArray<ReadonlyArray<number>>;

export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** One 4-connected same-color region: size, bounding box, centroid. */
export interface Region {
  readonly color: number;
  readonly size: number;
  readonly box: Box;
  readonly cx: number;
  readonly cy: number;
}

export interface Segmentation {
  readonly background: number;
  readonly regions: readonly Region[];
}

/** Port — TerminalSignal: the two ways a run ends. Anything else is `NOT_FINISHED`. */
export type TerminalSignal = 'WIN' | 'GAME_OVER';
export type EnvState = 'NOT_FINISHED' | TerminalSignal;

/** The one action vocabulary the mind may emit. ACTION6 is a click and carries x/y. */
export type MindActionName =
  | 'ACTION1' | 'ACTION2' | 'ACTION3' | 'ACTION4' | 'ACTION5' | 'ACTION6' | 'ACTION7';

export interface MindAction {
  readonly name: MindActionName;
  readonly x?: number;
  readonly y?: number;
}

/** A replay-history entry: a normal action, or the environment's own RESET. */
export interface ResetStep {
  readonly name: 'RESET';
}
export type ReplayStep = MindAction | ResetStep;

/** One observation of the environment — everything the mind is allowed to see. */
export interface Obs {
  readonly state: EnvState;
  readonly levelsCompleted: number;
  readonly winLevels: number;
  readonly availableActions: readonly number[];
  readonly grid: Grid;
  /** Optional pre-computed segmentation; renderers compute it when absent. */
  readonly segments?: Segmentation | null;
}

/**
 * Port — Env: the world the mind acts in. The mind's ONLY outlet is `act`;
 * in the self-modification domain the caller wires `act` to the propose door,
 * so every consequence still crosses the full governed gate chain.
 */
export interface Env {
  actions(): readonly number[];
  act(action: MindAction): Obs;
  reset(): Obs;
  observe(): Obs;
}

export type ChatRole = 'system' | 'user' | 'assistant';
export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
}

export interface TokenUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
}

export interface MindSocketReply {
  readonly text: string;
  readonly usage?: TokenUsage;
}

/**
 * Port — MindSocket: the model transport, supplied by the caller. This package
 * never performs I/O; it only shapes the messages and parses the reply text.
 */
export interface MindSocket {
  call(messages: readonly ChatMessage[]): Promise<MindSocketReply>;
}

/**
 * Port — Simulator: a deterministic, replayable ghost of the environment for
 * lookahead. The caller constructs it (seeded however it likes); rollout only
 * calls `reset` and `act`.
 */
export interface Simulator {
  reset(): Obs;
  act(action: MindAction): Obs;
}

/**
 * Port — EpisodicNote: distilled knowledge from a previous session, handed to
 * the mind as a strong-but-verify prior. Structural on purpose: this package
 * defines the shape only and imports no store.
 */
export interface EpisodicNote {
  readonly at: number;
  readonly runId: string;
  readonly outcome: string;
  readonly memo: string;
}
