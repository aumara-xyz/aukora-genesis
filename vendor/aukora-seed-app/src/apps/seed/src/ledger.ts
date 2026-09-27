// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Recursion ledger (pure, in-memory) — the session's replay guard, attempt counter, and lineage record.
 *
 * It holds NO key, signs nothing, and touches no disk or network. It exists so the orchestrator can enforce
 * fail-closed hard stops (a bounded number of attempts per session) and refuse replays (a nonce or an applied
 * intent may be used exactly once), and so a supersedes chain can be validated for reachability and depth.
 */
import { LIMITS } from './proposal.js';

export class RecursionLedger {
  private attemptCount = 0;
  private readonly consumedNonces = new Set<string>();
  /** intentId -> supersedes-chain depth (root = 0). Seeded with intents applied in prior sessions. */
  private readonly appliedIntents = new Map<string, number>();

  constructor(seed?: { readonly knownIntents?: Iterable<readonly [string, number]> }) {
    if (seed?.knownIntents) {
      for (const [intentId, depth] of seed.knownIntents) {
        if (typeof intentId === 'string' && Number.isSafeInteger(depth) && depth >= 0) this.appliedIntents.set(intentId, depth);
      }
    }
  }

  /** Consume one attempt. Returns false (without incrementing past the ceiling) once the budget is spent. */
  tryAttempt(): boolean {
    if (this.attemptCount >= LIMITS.MAX_ATTEMPTS) return false;
    this.attemptCount += 1;
    return true;
  }

  get attempts(): number {
    return this.attemptCount;
  }

  nonceConsumed(nonce: string): boolean {
    return this.consumedNonces.has(nonce);
  }

  consumeNonce(nonce: string): void {
    this.consumedNonces.add(nonce);
  }

  /** Depth of a known/applied ancestor intent, or undefined if unknown (⇒ unreachable lineage). */
  knownIntentDepth(intentId: string): number | undefined {
    return this.appliedIntents.get(intentId);
  }

  recordApplied(intentId: string, depth: number): void {
    // First-writer wins: an intent's canonical depth is fixed the first time it is applied.
    if (!this.appliedIntents.has(intentId)) this.appliedIntents.set(intentId, depth);
  }

  /** The ledger grants no authority — it only counts and remembers. Constant, by construction. */
  grantsAuthority(): false {
    return false;
  }
}
