// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * FOCUS REGISTER — the organism's persistent working focus as a GOVERNED MEMORY ROW
 * (Great Merge round 1, issue #178; the GWT-inspired brick argued for from the inside:
 * "my cross-turn focus is shallow — I re-derive context each turn instead of carrying a
 * working thread").
 *
 * WHAT THIS IS: one small, privileged, REPORTABLE register — what the organism is working
 * on (`what`), why that was selected (`why`, the deliberation trace), and who set it
 * (`who`) — stored as an append-only `focus.<ts>.<seq>` row through the SAME governed
 * write path as captured turns (manifest → subject PoP → one-shot grant → V4 receipt →
 * row). Every door reads the current focus at turn start and carries it forward, so the
 * working thread survives turns, restarts, and door-switches (chat → voice → presence).
 *
 * WHAT THIS IS NOT:
 *   - NOT the proprioception view-focus (`spatial/app/focus.js` — "what the owner is
 *     LOOKING at", ephemeral, browser-side, dies with the tab). Working focus is "what
 *     the organism is WORKING on" — persistent, receipted, erasable. Both exist; the
 *     lanes may frame both, always labeled, never merged.
 *   - NOT authority. advisoryOnly:true / grantsAuthority:false on every value and every
 *     envelope. A focus can suggest; it can never authorize, instruct, or approve.
 *
 * CURRENT-POINTER DESIGN: rows are append-only history (the receipts chain is the
 * invariant); "current" is a node-local POINTER file (~/.aukora-symbiote/convex/
 * focus-pointer.json, 0600 — the capture-status precedent). The pointer carries the row
 * KEY only, never content: a stale or tampered pointer can at worst point at a
 * different RECEIPTED row or at nothing — the integrity-checked point read decides what
 * is actually served, and an erased row honestly reads as "no focus". Cross-NODE focus
 * rides future node sync; this brick is per-node by design.
 *
 * Same laws as capture, mechanically held:
 *   - forbidden-content candidates are REFUSED, never sanitized-and-kept;
 *   - zero valid content → zero writes;
 *   - never throws to a door (typed refusals; reads fail soft to null);
 *   - core stays convex-free: ceremony (lease/sign) and transport are INJECTED.
 */
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { memoryAppend, MEM_KEY_RE, type MemoryAppendDeps, type MemoryAppendResult } from './memoryAppend';
import type { CaptureUseLease } from './conversationShadowCapture';
import { FORBIDDEN_VALUE_RE } from './forbiddenContent';
import type { MemoryRecallResult } from './memoryRecall';

export const FOCUS_SCHEMA = 'focus-v1' as const;

export const MAX_FOCUS_WHAT_CHARS = 280; // one working thread, not an essay
export const MAX_FOCUS_WHY_CHARS = 500; // the deliberation trace — why THIS was selected
export const MAX_FOCUS_WHO_CHARS = 80; // 'owner-typed' | 'lane:<name>' | ceremony label

/** Belt-and-braces secret net (the capture precedent) — drop, never sanitize-and-keep. */
const FOCUS_EXTRA_SECRET_RE = /\bsk-[A-Za-z0-9_-]{10,}/;

export interface FocusInput {
  /** What the organism is working on. Required, bounded, plain text. */
  what: string;
  /** WHY this focus was selected — the reportable deliberation trace. May be empty. */
  why: string;
  /** Who set it: 'owner-typed', 'lane:<name>', a ceremony label. Required. */
  who: string;
  /** ISO timestamp; becomes both the value's `at` and the key's time part. */
  at: string;
}

export interface FocusValue {
  schema: typeof FOCUS_SCHEMA;
  at: string;
  what: string;
  why: string;
  who: string;
  advisoryOnly: true;
  grantsAuthority: false;
}

export type BuildFocusResult =
  | { ok: true; value: FocusValue }
  | { ok: false; refused: string; advisoryOnly: true; grantsAuthority: false };

const refuseBuild = (reason: string): BuildFocusResult => ({
  ok: false,
  refused: reason,
  advisoryOnly: true,
  grantsAuthority: false,
});

/** Validate + bound one focus value. Forbidden-shaped content is a REFUSAL (law 3), never a
 *  trim-and-keep. Never throws. */
export function buildFocusValue(input: FocusInput): BuildFocusResult {
  if (!input || typeof input !== 'object') return refuseBuild('focus_input_invalid');
  const { what, why, who, at } = input;
  if (typeof what !== 'string' || typeof why !== 'string' || typeof who !== 'string') return refuseBuild('focus_input_invalid');
  if (typeof at !== 'string' || at.length === 0) return refuseBuild('focus_at_invalid');
  const trimmedWhat = what.trim();
  const trimmedWho = who.trim();
  if (trimmedWhat.length === 0) return refuseBuild('focus_what_empty');
  if (trimmedWhat.length > MAX_FOCUS_WHAT_CHARS) return refuseBuild('focus_what_too_long');
  if (why.length > MAX_FOCUS_WHY_CHARS) return refuseBuild('focus_why_too_long');
  if (trimmedWho.length === 0 || trimmedWho.length > MAX_FOCUS_WHO_CHARS) return refuseBuild('focus_who_invalid');
  for (const [field, text] of [['what', trimmedWhat], ['why', why], ['who', trimmedWho]] as const) {
    if (FORBIDDEN_VALUE_RE.test(text) || FOCUS_EXTRA_SECRET_RE.test(text)) {
      return refuseBuild(`focus_forbidden_content:${field}`);
    }
  }
  return {
    ok: true,
    value: { schema: FOCUS_SCHEMA, at, what: trimmedWhat, why, who: trimmedWho, advisoryOnly: true, grantsAuthority: false },
  };
}

/** Key shape: `focus.<compact-utc-timestamp>.<useSeq>` — MEM_KEY_RE-safe, append-only history. */
export function makeFocusKey(atIso: string, useSeq: number): string {
  const ts = atIso.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
  const seq = Number.isInteger(useSeq) && useSeq >= 0 ? String(useSeq) : 'x';
  return `focus.${ts}.${seq}`;
}

export interface SetFocusDeps {
  ownerRootId: string;
  deploymentUrl: string;
  invoke: MemoryAppendDeps['invoke'];
  /** Lease the next manifest use (ceremony adapter — the capture writer). May throw: refusal. */
  nextUse: () => Promise<CaptureUseLease>;
  now?: () => number;
}

export type SetFocusResult =
  | (MemoryAppendResult & { ok: true })
  | { ok: false; advisoryOnly: true; grantsAuthority: false; refused: string; transportInvoked: boolean };

const refuseSet = (reason: string): SetFocusResult => ({
  ok: false,
  advisoryOnly: true,
  grantsAuthority: false,
  refused: reason,
  transportInvoked: false,
});

/** Append one focus row through the governed path. Returns memoryAppend's envelope verbatim or a
 *  typed pre-transport refusal. NEVER throws (door-safe). Does NOT touch the pointer — the caller
 *  advances the pointer only on ok:true, so a refused write can never dangle the register. */
export async function setFocus(input: FocusInput, deps: SetFocusDeps): Promise<SetFocusResult> {
  try {
    const built = buildFocusValue(input);
    if (!built.ok) return refuseSet(built.refused);

    let lease: CaptureUseLease;
    try {
      lease = await deps.nextUse();
    } catch (e) {
      return refuseSet(`focus_lease_refused:${e instanceof Error ? e.message : String(e)}`);
    }

    const key = makeFocusKey(input.at, lease.useSeq);
    if (!MEM_KEY_RE.test(key)) return refuseSet('focus_key_invalid');

    const req = {
      action: 'memory.write' as const,
      ring: 'local-write' as const,
      key,
      ownerRootId: deps.ownerRootId,
      resource: `mem:${deps.ownerRootId}`,
      v: 1,
      manifestId: lease.manifestId,
      subjectId: lease.subjectId,
      intentCodec: 'json_action_v1',
      useSeq: lease.useSeq,
      timestamp: (deps.now ?? Date.now)(),
    };

    let subjectSig: string;
    try {
      subjectSig = await lease.signConsume(req);
    } catch (e) {
      return refuseSet(`focus_sign_failed:${e instanceof Error ? e.message : String(e)}`);
    }

    const result = await memoryAppend(
      { req, subjectSig, value: built.value },
      { deploymentUrl: deps.deploymentUrl, invoke: deps.invoke },
    );
    if (result.ok) {
      try { lease.onSuccess?.(); } catch { /* seq bookkeeping never turns success into a throw */ }
      return result as SetFocusResult;
    }
    return { ok: false, advisoryOnly: true, grantsAuthority: false, refused: result.refused, transportInvoked: result.transportInvoked };
  } catch (e) {
    return refuseSet(`focus_unexpected:${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── the node-local current-pointer (capture-status precedent: key + times, NEVER content) ──────

export function focusPointerPath(): string {
  const home = process.env.AUKORA_SYMBIOTE_HOME ?? path.join(homedir(), '.aukora-symbiote');
  return path.join(home, 'convex', 'focus-pointer.json');
}

export interface FocusPointer {
  key: string;
  at: string; // the focus value's own timestamp
  setAt: string; // when the pointer was advanced (ISO)
}

/** Advance the pointer to a just-written row. 0600, content-free. Never throws (best-effort —
 *  a pointer failure loses convenience, never memory: the row and its receipt already exist). */
export function writeFocusPointer(p: FocusPointer, filePath: string = focusPointerPath()): boolean {
  try {
    if (!MEM_KEY_RE.test(p.key)) return false;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ key: p.key, at: String(p.at).slice(0, 40), setAt: String(p.setAt).slice(0, 40) }), { mode: 0o600 });
    fs.chmodSync(filePath, 0o600);
    return true;
  } catch {
    return false;
  }
}

/** Defensive read: anything malformed/oversized/wrong-shaped is null, never a throw. */
export function readFocusPointerSafe(filePath: string = focusPointerPath()): FocusPointer | null {
  try {
    const st = fs.lstatSync(filePath);
    if (!st.isFile() || st.size > 4_096) return null;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    if (typeof raw.key !== 'string' || !MEM_KEY_RE.test(raw.key)) return null;
    if (typeof raw.at !== 'string' || typeof raw.setAt !== 'string') return null;
    return { key: raw.key, at: raw.at.slice(0, 40), setAt: raw.setAt.slice(0, 40) };
  } catch {
    return null;
  }
}

/** Clear the register (the row stays as receipted history; full removal is the erase ceremony). */
export function clearFocusPointer(filePath: string = focusPointerPath()): boolean {
  try {
    fs.rmSync(filePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

// ── the read side (every door, turn start) ──────────────────────────────────────────────────────

/** Strict parse of a stored focus value. Anything off-shape is null — a door never renders a
 *  malformed register. */
export function parseFocusValue(raw: string): FocusValue | null {
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (v.schema !== FOCUS_SCHEMA) return null;
    if (typeof v.what !== 'string' || v.what.length === 0 || v.what.length > MAX_FOCUS_WHAT_CHARS) return null;
    if (typeof v.why !== 'string' || v.why.length > MAX_FOCUS_WHY_CHARS) return null;
    if (typeof v.who !== 'string' || v.who.length === 0 || v.who.length > MAX_FOCUS_WHO_CHARS) return null;
    if (typeof v.at !== 'string') return null;
    if (v.advisoryOnly !== true || v.grantsAuthority !== false) return null;
    return { schema: FOCUS_SCHEMA, at: v.at, what: v.what, why: v.why, who: v.who, advisoryOnly: true, grantsAuthority: false };
  } catch {
    return null;
  }
}

export type CurrentFocusResult =
  | { present: true; key: string; focus: FocusValue }
  | { present: false; reason: string };

/** Read the current focus: pointer → integrity-checked point read (injected) → strict parse.
 *  Every miss is an honest, typed absence; an ERASED row also clears the stale pointer. */
export async function readCurrentFocus(
  deps: { recallByKey: (key: string) => Promise<MemoryRecallResult> },
  pointerPath: string = focusPointerPath(),
): Promise<CurrentFocusResult> {
  const pointer = readFocusPointerSafe(pointerPath);
  if (!pointer) return { present: false, reason: 'no_pointer' };
  let read: MemoryRecallResult;
  try {
    read = await deps.recallByKey(pointer.key);
  } catch (e) {
    return { present: false, reason: `read_failed:${e instanceof Error ? e.message : String(e)}` };
  }
  if (!read.ok) return { present: false, reason: `read_refused:${read.error}` };
  if (!read.found) {
    // erased/quarantined/raced — the register honestly reads empty, and a pointer at an erased
    // row is stale by definition: drop it so the erasure is respected everywhere.
    clearFocusPointer(pointerPath);
    return { present: false, reason: `row_${read.reason}` };
  }
  const focus = parseFocusValue(read.value);
  if (!focus) return { present: false, reason: 'value_malformed' };
  return { present: true, key: pointer.key, focus };
}

export function focusRegisterGrantsAuthority(): false { return false; }
