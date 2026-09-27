// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * Pure Aura Coherence projection over durable session records.
 *
 * This is a preparatory adapter, not the Aukora receipt chain. It deliberately
 * excludes message bodies, tool arguments, tool results, approval reasons,
 * and opaque ids. Every retained value can be replayed from event metadata.
 *
 * @module @aukora/face-settings/aura/projection
 */

import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
// Declaration-merging imports for the optional event families folded below.
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {
  AuraCoherenceProjection,
  AuraCoherenceState,
  AuraRecordDescriptor,
  AuraRecordKind,
} from './types.ts'

const RECENT_LIMIT = 18
const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

const recordKindSchema = z.union([
  z.literal('message'),
  z.literal('action'),
  z.literal('approval'),
  z.literal('policy'),
  z.literal('lifecycle'),
  z.literal('system'),
])

const descriptorSchema = z.object({
  seq: z.number().int().nonnegative(),
  time: z.number().nonnegative(),
  type: z.string(),
  kind: recordKindSchema,
  label: z.string(),
}).strict()

const auraCoherenceSchema: z.ZodType<AuraCoherenceProjection> = z.object({
  version: z.literal(1),
  source: z.literal('durable-session-log'),
  counts: z.object({
    records: z.number().int().nonnegative(),
    interactions: z.number().int().nonnegative(),
    turns: z.number().int().nonnegative(),
    humanMessages: z.number().int().nonnegative(),
    contextMessages: z.number().int().nonnegative(),
    assistantMessages: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    toolResults: z.number().int().nonnegative(),
    toolErrors: z.number().int().nonnegative(),
  }).strict(),
  approvals: z.object({
    asked: z.number().int().nonnegative(),
    allowed: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    unavailable: z.number().int().nonnegative(),
  }).strict(),
  confinement: z.object({
    preset: z.string().nullable(),
    sandbox: z.string().nullable(),
    approval: z.string().nullable(),
  }).strict(),
  lastSeq: z.number().int().min(-1),
  lastTime: z.number().nonnegative().nullable(),
  recordFingerprint: z.string().regex(/^[0-9a-f]{8}$/u),
  recent: z.array(descriptorSchema).max(RECENT_LIMIT),
  identityBound: z.literal(false),
  cryptographicReceipts: z.literal(false),
  externallyAnchored: z.literal(false),
}).strict()

/**
 * Construct the empty-log Aura state.
 * @returns a fresh unbound state with no observed records.
 */
export function emptyAuraCoherenceState(): AuraCoherenceState {
  return {
    version: 1,
    source: 'durable-session-log',
    counts: {
      records: 0,
      interactions: 0,
      turns: 0,
      humanMessages: 0,
      contextMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
      toolResults: 0,
      toolErrors: 0,
    },
    approvals: { asked: 0, allowed: 0, rejected: 0, cancelled: 0, unavailable: 0 },
    confinement: { preset: null, sandbox: null, approval: null },
    lastSeq: -1,
    lastTime: null,
    recordFingerprint: FNV_OFFSET.toString(16).padStart(8, '0'),
    recent: [],
    identityBound: false,
    cryptographicReceipts: false,
    externallyAnchored: false,
  }
}

/**
 * Extend a non-cryptographic FNV-1a checksum with content-free event metadata.
 * @param prior - prior eight-digit checksum.
 * @param event - durable event whose metadata is incorporated.
 * @returns the next eight-digit checksum.
 */
function extendFingerprint(prior: string, event: SessionEvent): string {
  let hash = Number.parseInt(prior, 16) >>> 0
  const input = `${event.seq}|${event.time}|${event.type};`
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * Classify an event without retaining payload content.
 * @param event - one durable session event.
 * @returns descriptor kind and display label.
 */
function describeEvent(event: SessionEvent): { kind: AuraRecordKind; label: string } {
  switch (event.type) {
    case 'user/message':
      return event.data.source.kind === 'user'
        ? { kind: 'message', label: 'Human message' }
        : { kind: 'system', label: 'Context entered' }
    case 'assistant/message':
      return { kind: 'message', label: event.data.interrupted === true ? 'Assistant interrupted' : 'Assistant message' }
    case 'tool/call':
      return { kind: 'action', label: `${event.data.name} requested` }
    case 'tool/result':
      return { kind: 'action', label: event.data.error === undefined ? 'Tool completed' : 'Tool failed' }
    case 'approval/asked':
      return { kind: 'approval', label: `${event.data.toolName} approval requested` }
    case 'approval/decided':
      return { kind: 'approval', label: `Approval ${event.data.outcome}` }
    case 'permission/preset':
      return { kind: 'policy', label: `Preset ${event.data.preset}` }
    case 'sandbox/mode':
      return { kind: 'policy', label: `Sandbox ${event.data.mode}` }
    case 'approval/policy':
      return { kind: 'policy', label: `Approval policy ${event.data.policy}` }
    case 'turn/start':
      return { kind: 'lifecycle', label: `Turn ${event.data.turn} opened` }
    case 'turn/end':
      return { kind: 'lifecycle', label: `Turn ${event.data.turn} ${event.data.reason.kind}` }
    case 'step/start':
      return { kind: 'lifecycle', label: `Step ${event.data.step} opened` }
    case 'step/end':
      return { kind: 'lifecycle', label: `Step ${event.data.step} closed` }
    default:
      // SessionEventMap is merge-extensible; unknown domain records retain
      // their exact type without guessing at payload meaning.
      return { kind: 'system', label: event.type }
  }
}

/**
 * Whether a durable record is one high-level interaction rather than a
 * lifecycle or rendering fact.
 * @param event - one durable event.
 * @returns true for messages, model-requested actions, approval asks, and policy changes.
 */
function isInteraction(event: SessionEvent): boolean {
  switch (event.type) {
    case 'user/message':
    case 'assistant/message':
    case 'tool/call':
    case 'approval/asked':
    case 'permission/preset':
    case 'sandbox/mode':
    case 'approval/policy':
      return true
    default:
      return false
  }
}

/**
 * Fold one durable event into Aura's content-free session adapter.
 * @param state - whole state before the event.
 * @param event - next committed event.
 * @returns the next whole state, or the same reference for a raw token chunk.
 */
export function applyAuraCoherenceEvent(
  state: AuraCoherenceState,
  event: SessionEvent,
): AuraCoherenceState {
  // This harness emits no streaming-chunk event: assistant output arrives as an
  // attempt record and then a message, so there is no delivery fragment to skip.
  const description = describeEvent(event)
  const descriptor: AuraRecordDescriptor = {
    seq: event.seq,
    time: event.time,
    type: event.type,
    kind: description.kind,
    label: description.label,
  }
  const next: AuraCoherenceState = {
    ...state,
    counts: {
      ...state.counts,
      records: state.counts.records + 1,
      interactions: state.counts.interactions + (isInteraction(event) ? 1 : 0),
    },
    lastSeq: event.seq,
    lastTime: event.time,
    recordFingerprint: extendFingerprint(state.recordFingerprint, event),
    recent: [...state.recent, descriptor].slice(-RECENT_LIMIT),
  }

  switch (event.type) {
    case 'turn/start':
      next.counts.turns += 1
      break
    case 'user/message':
      if (event.data.source.kind === 'user') next.counts.humanMessages += 1
      else next.counts.contextMessages += 1
      break
    case 'assistant/message':
      next.counts.assistantMessages += 1
      break
    case 'tool/call':
      next.counts.toolCalls += 1
      break
    case 'tool/result':
      next.counts.toolResults += 1
      if (event.data.error !== undefined) next.counts.toolErrors += 1
      break
    case 'approval/asked':
      next.approvals = { ...state.approvals, asked: state.approvals.asked + 1 }
      break
    case 'approval/decided':
      next.approvals = { ...state.approvals }
      if (event.data.outcome === 'allowed-once') next.approvals.allowed += 1
      else next.approvals[event.data.outcome] += 1
      break
    case 'permission/preset':
      next.confinement = { ...state.confinement, preset: event.data.preset }
      break
    case 'sandbox/mode':
      next.confinement = { ...state.confinement, sandbox: event.data.mode }
      break
    case 'approval/policy':
      next.confinement = { ...state.confinement, approval: event.data.policy }
      break
    default:
      break
  }
  return next
}

/** Aura's replayable session projection registered on `ctx.sessionProjections`. */
export const auraCoherenceProjectionDefinition = {
  key: 'auraCoherence',
  stateVersion: 1,
  stateSchema: auraCoherenceSchema,
  init: emptyAuraCoherenceState,
  apply: applyAuraCoherenceEvent,
  wire: {
    viewSchema: auraCoherenceSchema,
    view: state => state,
  },
} satisfies ProjectionDefinition<'auraCoherence', AuraCoherenceState>
