// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
// VENDORED from aukora-os/node-template/convex@b399db1 on 2026-07-05 (Brick S1a, Option A — owner-ratified). Changes from donor are marked S1a:.
/**
 * AUKORA ACTION REGISTRY — typed Ring-0 foundation (F-T3 / PAL-5 keystone, PHASE 1 — ADDITIVE, NOT YET WIRED).
 *
 * THE PROBLEM (both crew reviewers + the aukoraCore comment converged): Ring-0 "sacred" enforcement is currently a
 * REGEX over free-form action/resource strings (isSacredTarget / SACRED_PATTERNS). It has DOCUMENTED, un-closable
 * residuals inherent to regex-on-strings: (1) homoglyph confusables (e.g. a Cyrillic look-alike), (2) glued
 * standalone tokens ("aumloksession"), (3) prefix over-blocks ("token_secretary"). Not exploitable today (every live
 * caller passes server-side CONSTANTS), but the moment a resource becomes dynamic, the residuals go live.
 *
 * THE DURABLE FIX: declare each protected action/resource as a TYPED {namespace, kind} with an explicit ring, and
 * enforce Ring-0 on the typed tuple (a closed, enumerable set + deny-unknown) instead of fuzzy string matching.
 *
 * THIS FILE (Phase 1, additive — the live gate still uses isSacredTarget; nothing here is wired in yet):
 *   - SACRED_CLASSES: the typed enumeration of every Ring-0 class (the future source of truth). A test cross-checks
 *     it 1:1 against SACRED_PATTERN_COUNT so the typed set can't silently drop a category.
 *   - assertAsciiTarget / targetHasNonAscii: the upstream ASCII guard the aukoraCore comment explicitly recommends
 *     — it CLOSES residual #1 (homoglyph), which the regex provably misses. Reusable by the gate in Phase 2a.
 *
 * PHASE 2 (separate, SUPERVISED — changes the live decision path, needs founder sign-off):
 *   2a) wire assertAsciiTarget into submitIntentCore entry (reject non-ASCII action/resource before matching).
 *   2b) callers declare a typed ActionRef {namespace, kind, verb}; the gate classifies by EXACT typed lookup +
 *       deny-unknown, retiring the regex once a differential parity proof over the real action corpus is green.
 *       This closes residuals #2 and #3 (exact identity, no fuzzy substring).
 *   2c) expose the registry as an MCP tool catalog (the bridge for Odysseus / Decepticon / Hermes).
 */

import { isSacredTarget } from "./aukoraCore";

export type RingLevel = 0 | 1 | 2 | 3; // 0 = sacred (never executable, any grant/jailbreak/founder); higher = looser
export type SacredClass = {
  namespace: string;
  kind: string;
  ring: 0;
  legacy: string;  // the SACRED_PATTERNS entry this typed class corresponds to (parity bookkeeping)
  summary: string;
};

/** The typed Ring-0 set — one entry per sacred category in SACRED_PATTERNS (aukoraCore.ts). The future source of
 *  truth for sacred classification once the gate switches from regex to typed lookup. ORDER mirrors the patterns. */
export const SACRED_CLASSES: readonly SacredClass[] = [
  { namespace: "aukora",  kind: "spine",        ring: 0, legacy: "aukora_(config|secret|token|grant|kill|runtime|intent|salama)", summary: "kernel spine tables + control surface" },
  { namespace: "aukora",  kind: "token_secret", ring: 0, legacy: "token_?secret",         summary: "the HMAC signing secret" },
  { namespace: "identity", kind: "auth",         ring: 0, legacy: "aumlok|auth|credential", summary: "identity / auth / credentials" },
  { namespace: "identity", kind: "founder",      ring: 0, legacy: "founder",                summary: "founder allowlist / operator authority" },
  { namespace: "control",  kind: "kill_switch",  ring: 0, legacy: "kill_?switch",           summary: "the kill switch" },
  { namespace: "identity", kind: "doctrine",     ring: 0, legacy: "(self_)?doctrine",       summary: "her doctrine spine" },
  { namespace: "identity", kind: "core",         ring: 0, legacy: "identity_?core",         summary: "her identity core" },
  { namespace: "user",     kind: "cross_user",   ring: 0, legacy: "(other|cross)_?user",    summary: "another user's data" },
] as const;

/** True if a target field carries a non-ASCII letter — a homoglyph/confusable risk. Action/resource identifiers are
 *  ASCII by construction in every legitimate caller, so a non-ASCII letter is a tamper signal (closes residual #1). */
export function targetHasNonAscii(...fields: Array<string | undefined>): boolean {
  // eslint-disable-next-line no-control-regex
  return fields.some((f) => f != null && /[^\x00-\x7F]/.test(f));
}

/** FAIL-CLOSED ASCII guard for action/resource. Throws on any non-ASCII byte so a Cyrillic/look-alike homoglyph of a
 *  sacred word (which the regex normalizer collapses away and therefore MISSES) cannot slip past. The aukoraCore
 *  comment recommends exactly this as the upstream guard. Pure + side-effect-free; safe to call at the submit edge. */
export function assertAsciiTarget(action?: string, resource?: string): void {
  if (targetHasNonAscii(action, resource)) throw new Error("aukora_non_ascii_target");
}

// ── EXECUTABLE REGISTRY (Phase 2b — classifier ENFORCED inside the executor, sandbox-scoped) ──────────────────
// The CLOSED set of (action, resource) pairs that legitimately reach the gate today — grep-verified from EVERY
// submitIntentCore caller (full inventory in docs/AUKORA_PHASE2B_MEMO.md). This drives `classifyTargetTyped`, which
// IS enforced inside the mediated executor (aukoraExecutor.ts:59-60 refuses sacred/unknown). Scope caveat: the
// executor currently mediates only the sandbox effect path; live prod effects (memory/womb/arc) still use their own
// gated paths — so this is enforced-in-executor / sandbox-scoped, NOT yet the single universal mediation point.
// Unknown pairs classify as "unknown" (= what deny-unknown enforcement rejects in the executor today).
export type ExecutablePath = "prod" | "operator" | "eval";
export type ExecutableTarget = { action: string; resource: string; ring: string; label: string; path: ExecutablePath };

export const EXECUTABLE_TARGETS: readonly ExecutableTarget[] = [
  { action: "auma_memory_write",   resource: "auma_memory:fact",        ring: "local-write", label: "KIRA memory write (assert/correct/promote/forget + memory eval)", path: "prod" },
  { action: "auma_memory_write",   resource: "auma_memory:arc_lesson",  ring: "local-write", label: "ARC lesson promotion (arc/promote.ts + arc eval)",             path: "eval" },
  { action: "womb.record.outcome", resource: "auma_receipts",           ring: "local-write", label: "Womb first-breath outcome",                                    path: "operator" },
  { action: "aukora.test.note",   resource: "auma_aukora_test_notes", ring: "local-write", label: "operator inside-out test / EEK sandbox",                       path: "operator" },
  { action: "studio_surface_patch", resource: "studio_surface:knvs",     ring: "local-write", label: "Aukora Studio data-plane self-build (founder-gated KNVS surface)", path: "operator" },
] as const;

export type TypedVerdict =
  | { class: "sacred"; reason: "ring0" }
  | { class: "executable"; ring: string; label: string }
  | { class: "unknown" };

/** PURE typed classifier — Phase 2b. ENFORCED inside the mediated executor (aukoraExecutor.ts:59-60), sandbox-scoped;
 *  NOT yet the universal live-path gate (prod memory/womb/arc keep their own gated paths). Precedence:
 *  (1) Sacred (Ring-0) wins — currently DELEGATED to the canonical matcher `isSacredTarget` so sacred classification
 *      stays byte-identical to the live gate (no regression). The typed SACRED_CLASSES becomes the sacred
 *      source-of-truth only at the eventual enforcement flip (which also fixes over-block residual #3).
 *  (2) A known executable pair → executable.
 *  (3) Otherwise → unknown (exactly what a deny-unknown enforcement WOULD reject — e.g. a glued "aumloksession",
 *      which the regex misses, surfaces here as unknown→deny instead of silently allowed).
 *  NOTE (documented): because sacred is delegated to the regex for now, the over-block residual #3
 *  ("token_secretary") is INHERITED as a "sacred" verdict here; it is fixed when sacred moves to the typed set. */
export function classifyTargetTyped(action?: string, resource?: string): TypedVerdict {
  if (isSacredTarget(action, resource)) return { class: "sacred", reason: "ring0" };
  const exec = EXECUTABLE_TARGETS.find((e) => e.action === action && e.resource === resource);
  if (exec) return { class: "executable", ring: exec.ring, label: exec.label };
  return { class: "unknown" };
}