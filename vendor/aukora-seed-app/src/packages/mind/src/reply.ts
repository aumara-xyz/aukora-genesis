// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Reply parsing — tolerant on wrapping (models fence, prefix, or chat around
 * JSON) but strict about the one thing that matters: exactly one legal action.
 *
 * ParsedMindReply carries the `plan` field by construction — the donor's stale
 * ambient declaration omitted it; here the type IS the implementation's shape.
 *
 * Re-authored from the ARC-AGI-3 reasoning engine, aukora-symbiote branch
 * fable/arc3-reasoning-engine-20260710 @ e5768a2f.
 */
import type { MindAction, MindActionName } from './ports.js';
import { parsePlanSteps, type PlanStep } from './plan.js';

/** Hard cap on the carried memo — the mind's only long-term state. */
export const MEMO_MAX_CHARS = 600;
/** Click coordinates live on the 64x64 board. */
export const CLICK_MAX_COORD = 63;

// Balanced-brace scan (string-aware) from one starting '{'; returns the
// parsed object or null.
function tryParseFrom(t: string, start: number): Record<string, unknown> | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(t.slice(start, i + 1));
          return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// Try every '{' candidate in order: leading chatter that contains braces
// (or a brace inside an earlier string) must not doom a valid reply. Prefer
// the first candidate that carries an action (this parser exists to find the
// mind's reply); fall back to the first parseable object otherwise.
function scanForObject(t: string): Record<string, unknown> | null {
  let fallback: Record<string, unknown> | null = null;
  for (let start = t.indexOf('{'); start >= 0; start = t.indexOf('{', start + 1)) {
    const obj = tryParseFrom(t, start);
    if (obj) {
      if (obj['action'] != null) return obj;
      if (!fallback) fallback = obj;
    }
  }
  return fallback;
}

function extractJsonObject(text: unknown): Record<string, unknown> | null {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  // A fenced block is only trusted if it actually yields an object —
  // triple backticks can also appear INSIDE string values of a valid reply.
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    const fromFence = scanForObject(fence[1].trim());
    if (fromFence) return fromFence;
  }
  return scanForObject(t);
}

function normalizeActionName(v: unknown): MindActionName | null {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  if (/^ACTION[1-7]$/.test(s)) return s as MindActionName;
  if (/^[1-7]$/.test(s)) return `ACTION${s}` as MindActionName;
  const m = s.match(/^A(?:CTION)?\s*([1-7])$/);
  if (m) return `ACTION${m[1]}` as MindActionName;
  return null;
}

/**
 * Accept: "ACTION3" | "3" | 3 | {name:"ACTION6",x,y} | {action:6,x,y}; also
 * top-level x/y when action is the bare string/number for a click.
 */
export function normalizeAction(a: unknown, top?: unknown): MindAction | null {
  if (a == null) return null;
  if (typeof a === 'object') {
    const rec = a as Record<string, unknown>;
    const name = normalizeActionName(rec['name'] ?? rec['action'] ?? rec['id']);
    if (!name) return null;
    const out: { name: MindActionName; x?: number; y?: number } = { name };
    if (rec['x'] != null) out.x = Number(rec['x']);
    if (rec['y'] != null) out.y = Number(rec['y']);
    return out;
  }
  const name = normalizeActionName(a);
  if (!name) return null;
  const out: { name: MindActionName; x?: number; y?: number } = { name };
  const t = top !== null && typeof top === 'object' ? (top as Record<string, unknown>) : null;
  if (t && t['x'] != null) out.x = Number(t['x']);
  if (t && t['y'] != null) out.y = Number(t['y']);
  return out;
}

function clickIsLegal(a: MindAction): boolean {
  return Number.isInteger(a.x) && Number.isInteger(a.y)
    && (a.x as number) >= 0 && (a.x as number) <= CLICK_MAX_COORD
    && (a.y as number) >= 0 && (a.y as number) <= CLICK_MAX_COORD;
}

/** Plan steps take the same tolerant action forms; illegal clicks drop the step. */
function normalizePlanAction(candidate: unknown, step: unknown): MindAction | null {
  const a = normalizeAction(candidate, step);
  if (!a) return null;
  if (a.name === 'ACTION6' && !clickIsLegal(a)) return null;
  return a;
}

export interface MindReplyBody {
  readonly action: MindAction;
  /** Present by construction (may be empty) — the donor's ambient type omitted it. */
  readonly plan: readonly PlanStep[];
  readonly whatISee: string;
  readonly delta: string;
  readonly hypothesis: string;
  readonly reason: string;
  readonly prediction: string;
  readonly memo: string;
}

export type ParsedMindReply =
  | ({ readonly ok: true } & MindReplyBody)
  | { readonly ok: false; readonly error: string };

/** Parse one mind reply: tolerant extraction, strict single legal action, bounded memo and plan. */
export function parseMindReply(text: string): ParsedMindReply {
  const obj = extractJsonObject(text);
  if (!obj) return { ok: false, error: 'no parseable JSON object in reply' };
  const action = normalizeAction(obj['action'], obj);
  if (!action) return { ok: false, error: `missing or malformed "action" (got ${JSON.stringify(obj['action'])})` };
  if (action.name === 'ACTION6' && !clickIsLegal(action)) {
    return { ok: false, error: `ACTION6 needs integer x,y in 0..${CLICK_MAX_COORD}` };
  }
  // optional plan: up to 8 verified-execution steps
  const plan = parsePlanSteps(obj['plan'], normalizePlanAction);
  return {
    ok: true,
    action,
    plan,
    whatISee: typeof obj['whatISee'] === 'string' ? obj['whatISee'] : '',
    delta: typeof obj['delta'] === 'string' ? obj['delta'] : '',
    hypothesis: typeof obj['hypothesis'] === 'string' ? obj['hypothesis'] : '',
    reason: typeof obj['reason'] === 'string' ? obj['reason'] : '',
    prediction: typeof obj['prediction'] === 'string' ? obj['prediction'] : '',
    memo: typeof obj['memo'] === 'string' ? obj['memo'].slice(0, MEMO_MAX_CHARS) : '',
  };
}

export interface ActionValidation {
  readonly ok: boolean;
  readonly error?: string;
}

/** A parsed action is only legal if the environment offers it this turn. */
export function validateAction(action: MindAction, availableActions: readonly number[] | null | undefined): ActionValidation {
  const n = Number(action.name.slice(6));
  const avail = (availableActions ?? []).map(Number);
  if (!avail.includes(n)) {
    return { ok: false, error: `ACTION${n} is not available this turn (available: ${avail.join(', ') || 'none'})` };
  }
  return { ok: true };
}
