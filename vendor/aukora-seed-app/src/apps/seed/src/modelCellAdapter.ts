// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Generic model-cell adapter (R48) — the SMALLEST surface that turns raw model output into an UNSIGNED pending
 * intent, so a live HTTP proposal can reach the EXISTING immutable governed crossing ([[governedCrossing]]) without
 * a new workflow or authority path.
 *
 * "Model cell" is provider-agnostic: Inkling served through a Tinker adapter, a local model, or any transport — the
 * adapter never names one and trusts none. It consumes ONLY the model's structured HINTS (goal / rationale /
 * affected-path guesses / risk notes) and emits a [[PendingIntentV1]]. It does NOT carry file content: the real
 * bytes are re-read downstream (the INSIDE_OUT law — the model drafts hints, the carrying lane supplies real bytes,
 * the owner signs). Model output, Tinker adapters, Convex state, AURA and Fu all grant ZERO authority; this adapter
 * is pure, deterministic, total (drop-not-fail, bounded), and `grantsAuthority:false`.
 *
 * Terminates at: model output → (this adapter) → unsigned pending intent → translateToEnvelope → R47 qualifier
 * (halts before signature) → Fu advisory → fresh AUMLOK owner halt → R37 reference monitor → byte-bound isolated
 * candidate. Nothing here signs, applies, or creates a second workflow.
 */
import { canonicalHash } from '@aukora/kernel/canonical';
import { scanForSecrets } from '@aukora/evidence';
import { scanForbiddenKeys, scanForbiddenValues } from './forbiddenContent.js';
import { PENDING_INTENT_SCHEMA, type PendingIntentV1 } from './governedCrossing.js';

export type EpistemicStatus = 'verified' | 'inferred' | 'owner_stated' | 'unknown';

/** The raw, UNTRUSTED structured output a model cell emits. Everything is a hint; nothing is authority. */
export interface ModelCellOutput {
  readonly goal?: unknown;
  readonly rationale?: unknown;
  /** Affected paths as strings or {path, epistemicStatus} — the model's GUESS; downstream re-reads real files. */
  readonly affectedPaths?: unknown;
  readonly riskNotes?: unknown;
  /** Untrusted cell/provider label (e.g. "inkling"): recorded as provenance only, never trusted as authority. */
  readonly cell?: unknown;
}

// Bounds so a hostile/huge model reply can never exhaust anything downstream.
const MAX_GOAL = 512;
const MAX_RATIONALE = 2000;
const MAX_RISK = 1000;
const MAX_PATHS = 32;
const MAX_PATH_LEN = 1024;
const EPISTEMIC: ReadonlySet<EpistemicStatus> = new Set(['verified', 'inferred', 'owner_stated', 'unknown']);
// A goal/rationale that tries to talk itself into authority is refused (defense in depth; the prose is non-binding).
const AUTHORITY_SHAPE = /grants?\s*authority|live-?apply|sign[-\s]?for[-\s]?owner|owner-?impersonat|bypass\s*consent|self-?sign/i;

export type AdaptReasonClass =
  | 'model-cell:bad-output'
  | 'model-cell:no-goal'
  | 'model-cell:no-affected-paths'
  | 'model-cell:authority-shaped'
  | 'model-cell:forbidden-content';

export type AdaptResult =
  | { readonly ok: true; readonly intent: PendingIntentV1 }
  | { readonly ok: false; readonly reasonClass: AdaptReasonClass; readonly text: string };

function boundedString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length === 0 ? null : t.slice(0, max);
}

/** Normalize the model's affected-path guesses (drop-not-fail): each becomes {path, epistemicStatus}; a status the
 *  model didn't honestly label defaults to 'unknown'. Deduped, bounded, order-stable. */
function normalizePaths(raw: unknown): { path: string; epistemicStatus: EpistemicStatus }[] {
  if (!Array.isArray(raw)) return [];
  const out: { path: string; epistemicStatus: EpistemicStatus }[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_PATHS) break;
    let path: string | null = null;
    let status: EpistemicStatus = 'unknown';
    if (typeof item === 'string') path = boundedString(item, MAX_PATH_LEN);
    else if (item && typeof item === 'object') {
      path = boundedString((item as { path?: unknown }).path, MAX_PATH_LEN);
      const s = (item as { epistemicStatus?: unknown }).epistemicStatus;
      if (typeof s === 'string' && EPISTEMIC.has(s as EpistemicStatus)) status = s as EpistemicStatus;
    }
    if (path === null || seen.has(path)) continue;   // drop malformed/duplicate; never throw
    seen.add(path);
    out.push({ path, epistemicStatus: status });
  }
  return out;
}

/**
 * Adapt one model-cell output into an UNSIGNED pending intent. Total: never throws. Refuses malformed output, an
 * output with no goal or no usable affected path, an authority-shaped goal/rationale, and any forbidden (secret/
 * authority) content. The result grants no authority and carries no trusted file content.
 */
export function adaptModelOutput(raw: unknown): AdaptResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reasonClass: 'model-cell:bad-output', text: 'refused: model output is not an object' };
  const out = raw as ModelCellOutput;

  const goal = boundedString(out.goal, MAX_GOAL);
  if (goal === null) return { ok: false, reasonClass: 'model-cell:no-goal', text: 'refused: model output has no usable goal' };
  const rationale = boundedString(out.rationale, MAX_RATIONALE) ?? '';
  const riskNotes = boundedString(out.riskNotes, MAX_RISK) ?? 'unspecified';
  const affectedPaths = normalizePaths(out.affectedPaths);
  if (affectedPaths.length === 0) return { ok: false, reasonClass: 'model-cell:no-affected-paths', text: 'refused: model output declared no usable affected path' };

  // Defense in depth: a prose field that tries to grant authority is refused (even though prose is non-binding).
  if (AUTHORITY_SHAPE.test(goal) || AUTHORITY_SHAPE.test(rationale) || AUTHORITY_SHAPE.test(riskNotes)) {
    return { ok: false, reasonClass: 'model-cell:authority-shaped', text: 'refused: model output prose is authority-shaped' };
  }
  // No secret/authority keys or values anywhere in the raw output — structural scan PLUS the canonical repo-wide
  // secret scanner (`@aukora/evidence`, the same gate CI uses), which catches provider keys the structural value
  // regex misses (e.g. dash-bearing `sk-or-v1-…`). Both are content-free: only a finding count is reported.
  const forbidden = [...scanForbiddenKeys(out), ...scanForbiddenValues(out)];
  const scannerHits = scanForSecrets(`${goal}\n${rationale}\n${riskNotes}\n${affectedPaths.map((p) => p.path).join('\n')}`);
  if (forbidden.length > 0 || scannerHits.length > 0) {
    return { ok: false, reasonClass: 'model-cell:forbidden-content', text: `refused: forbidden/secret content in model output (${forbidden.length + scannerHits.length})` };
  }

  // Deterministic intent id over the HONEST fields only (never the untrusted cell label).
  const intentId = canonicalHash({ domain: 'AUKORA-PENDING-INTENT/1', goal, rationale, riskNotes, affectedPaths });

  const intent: PendingIntentV1 = {
    schema: PENDING_INTENT_SCHEMA,
    intentId,
    goal, rationale, riskNotes,
    affectedPaths,
    authoredBy: 'workbench',            // a model cell is a workbench-class author — never 'owner'
    advisoryOnly: true,
    grantsAuthority: false,
  };
  return { ok: true, intent };
}

/** HARD: the adapter shapes advisory hints; it never signs, applies, or mints authority. Constant, by construction. */
export function modelCellAdapterGrantsAuthority(): false {
  return false;
}
