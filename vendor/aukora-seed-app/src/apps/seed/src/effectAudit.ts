// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Effect audit ledger (#22 overnight) — the forensic layer that ENFORCES the directive's closing invariant across
 * an effect's WHOLE lifecycle (not just a single transition):
 *
 *   "No clean success may lack a durable completion reference, and no crash may create a second candidate."
 *
 * An append-only, content-free ledger of phase transitions. It refuses — at append time — any transition that
 * would violate either global property, and `verify()` re-proves both over the entire log. It carries no
 * proposal content, no authorization, no key; only effect ids, phase labels, a completion-ref presence bit, and
 * timestamps. Pure; grants no authority.
 *
 * Phase labels are plain strings kept in lockstep with the effect protocol's EffectPhase (not imported, so this
 * layer is self-contained and does not depend on the protocol module landing first).
 */

export interface EffectAuditEntry {
  readonly effectId: string;            // 64-hex
  readonly fromPhase: string | null;    // null = the effect's first recorded phase
  readonly toPhase: string;
  /** Whether this transition carries a durable completion reference (presence bit only — never the ref value). */
  readonly hasCompletionRef: boolean;
  readonly at: string;                  // ISO timestamp (ordering evidence only)
}

export type AuditAppend =
  | { readonly ok: true; readonly index: number }
  | { readonly ok: false; readonly reasonClass: string };

const EXECUTING = 'EXECUTING';
const COMMITTED = 'COMMITTED';
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Append-only ledger. Every append is validated against the two global invariants BEFORE it is recorded, so a
 * violating transition never enters the log (fail-closed). Content-free by construction.
 */
export class EffectAuditLedger {
  private readonly entries: EffectAuditEntry[] = [];
  /** per-effect count of transitions INTO EXECUTING — the "candidate created" event; must never exceed 1. */
  private readonly executingCount = new Map<string, number>();

  append(entry: EffectAuditEntry): AuditAppend {
    if (typeof entry.effectId !== 'string' || !HEX64.test(entry.effectId)) return { ok: false, reasonClass: 'audit:bad-effect-id' };
    if (typeof entry.toPhase !== 'string' || entry.toPhase.length === 0) return { ok: false, reasonClass: 'audit:bad-phase' };
    if (typeof entry.hasCompletionRef !== 'boolean') return { ok: false, reasonClass: 'audit:bad-completion-bit' };

    // INVARIANT A — no second candidate: a transition INTO EXECUTING may happen at most once per effect.
    if (entry.toPhase === EXECUTING) {
      const prior = this.executingCount.get(entry.effectId) ?? 0;
      if (prior >= 1) return { ok: false, reasonClass: 'audit:second-candidate' };
    }
    // INVARIANT B — no clean success without a durable completion reference.
    if (entry.toPhase === COMMITTED && entry.hasCompletionRef !== true) return { ok: false, reasonClass: 'audit:null-completion' };

    // record
    if (entry.toPhase === EXECUTING) this.executingCount.set(entry.effectId, (this.executingCount.get(entry.effectId) ?? 0) + 1);
    this.entries.push({ effectId: entry.effectId, fromPhase: entry.fromPhase, toPhase: entry.toPhase, hasCompletionRef: entry.hasCompletionRef, at: entry.at });
    return { ok: true, index: this.entries.length - 1 };
  }

  log(): readonly EffectAuditEntry[] {
    return this.entries.slice();
  }

  /** How many candidates a given effect produced (transitions into EXECUTING). Must be 0 or 1. */
  candidatesCreated(effectId: string): number {
    return this.executingCount.get(effectId) ?? 0;
  }
}

export type AuditVerdict = { readonly ok: true } | { readonly ok: false; readonly reasonClass: string; readonly effectId: string };

/**
 * Re-prove BOTH global invariants over an arbitrary log (e.g. one rehydrated from durable state after a crash):
 *   A — every effect entered EXECUTING at most once (no second candidate);
 *   B — every COMMITTED transition carried a completion reference (no clean success with a null receipt).
 * Independent of the append-time guard, so a tampered/rehydrated log is still checked.
 */
export function verifyAuditLog(log: readonly EffectAuditEntry[]): AuditVerdict {
  const executing = new Map<string, number>();
  for (const e of log) {
    if (e.toPhase === EXECUTING) {
      const n = (executing.get(e.effectId) ?? 0) + 1;
      executing.set(e.effectId, n);
      if (n > 1) return { ok: false, reasonClass: 'audit:second-candidate', effectId: e.effectId };
    }
    if (e.toPhase === COMMITTED && e.hasCompletionRef !== true) return { ok: false, reasonClass: 'audit:null-completion', effectId: e.effectId };
  }
  return { ok: true };
}

/** HARD: the audit ledger records content-free ordering evidence; it grants no authority. Constant. */
export function effectAuditGrantsAuthority(): false {
  return false;
}
