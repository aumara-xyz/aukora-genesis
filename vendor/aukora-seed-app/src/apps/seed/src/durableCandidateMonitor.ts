// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Durable candidate reference monitor (R54) — the PROTECTED primary-door authority brick.
 *
 * Same ONE authorization semantics as `CandidateReferenceMonitor` (the shared `buildCandidateKernelRequest` +
 * `candidatePolicyBytes` feed the same kernel `decide()`), with one difference that closes the Diamond gap on the
 * live path: the consumption is journalled through `@aukora/kernel-node`'s crash-safe `TrustedStateStore`
 * BEFORE `allowed` is returned — so by the time the candidate stage runs its first git mutation, the consumed
 * authorization id, the advanced kernel receipt head, and a content-free PREPARED effect descriptor are already
 * fsync'd on disk. A SIGKILL at ANY point after that cannot un-consume the authorization (a fresh process replays →
 * refusal); a crash BEFORE the store's atomic rename leaves nothing consumed and no effect run.
 *
 * Placement (the protected Node-side call site): mindDoor → localCeremonyRunner → durableRecursion →
 * localCandidateStage step 4b — after the cheap git prechecks (so a dirty tree / existing branch never consumes),
 * BEFORE the attempt receipt and every git mutation. Convex receives only the resulting projection afterward:
 * this module runs in the Node runtime, is never imported by any Convex handler, and the persisted trusted state
 * is content-free (roots' PUBLIC keys, consumed ids, receipt head, hash-only effect descriptors — no signature,
 * no private key, no proposal content).
 *
 * Fail-closed by construction: a locked store (a concurrent ceremony holds the single-writer lock), a rollback
 * (older state restored over the high-water), a corrupt/unknown-schema store, or ANY journal/disk failure refuses
 * the materialization — no git effect, no "applied" projection. Refusal codes are content-free class labels.
 *
 * HONEST LIMIT: the trusted roots are pinned into the durable state at first commit (genesis). Rotating the owner
 * root requires an explicit owner-directed state migration (a new state dir) — deliberately NOT automatic, so a
 * swapped root can never silently re-open consumed authority.
 */
import { realpathSync, readlinkSync } from 'node:fs';
import { resolve, dirname, basename, sep } from 'node:path';
import {
  TrustedStateStore, RollbackRefusedError, WriterLockedError, TrustedStoreCorruptError,
  TrustedStoreUnsafePathError, type CrashHook,
} from '@aukora/kernel-node';
import type { AumlokAuthorityRootV2, SignedPromotionV2, TrustedStateV1 } from '@aukora/kernel/schemas';
import {
  CandidateReferenceMonitor, buildCandidateKernelRequest, candidatePolicyBytes, type MonitorDecision,
} from './candidateReferenceMonitor.js';
import { candidateBranchName } from './localCandidateStage.js';
import type { BranchCandidate } from './ideEnvelope.js';

/**
 * Canonicalize a path for the isolation fence (R54 review repair): lexical resolve, then realpath the NEAREST
 * EXISTING ancestor and re-append the not-yet-created suffix. This resolves every symlink an attacker can
 * pre-plant (a symlinked parent routing an "outside" path back inside the repo) while still working for dirs the
 * store will mkdir later. Lives HERE (the effect-adjacent module) because the ceremony runner is a RUNTIME module
 * that must not import fs under the structural containment law.
 */
function canonicalizePath(p: string): string {
  let current = resolve(p);
  const suffix: string[] = [];
  // Bounded walk (guards symlink cycles). On exhaustion the caller-side fence still fails SAFE overall: a
  // cyclic path can never be mkdir'd by the store either (ELOOP), so the monitor refuses fail-closed anyway.
  for (let hop = 0; hop < 64; hop++) {
    try {
      return suffix.length === 0 ? realpathSync(current) : resolve(realpathSync(current), ...suffix.slice().reverse());
    } catch {
      // realpath refuses a BROKEN symlink (target not created yet) — but mkdir would FOLLOW it, so the fence
      // must see through it too: resolve the link text manually and keep canonicalizing the target.
      try {
        current = resolve(dirname(current), readlinkSync(current));
        continue;
      } catch { /* not a symlink — walk up to the nearest existing ancestor */ }
      const parent = dirname(current);
      if (parent === current) break; // no existing ancestor at all — lexical resolution below is final
      suffix.push(basename(current));
      current = parent;
    }
  }
  return suffix.length === 0 ? resolve(current) : resolve(current, ...suffix.slice().reverse());
}

/**
 * TRUE when the trusted-state dir canonically resolves EQUAL TO or BENEATH any fence root (the repo working tree,
 * the disposable worktree base). The durable authority store must survive candidate cleanup and never ride a
 * commit — inside either fence, consumed authority could be erased or exfiltrated.
 */
export function trustedStateDirInsideFence(stateDir: string, fences: readonly (string | undefined)[]): boolean {
  const stateReal = canonicalizePath(stateDir);
  for (const fence of fences) {
    if (fence === undefined) continue;
    const fenceReal = canonicalizePath(fence);
    if (stateReal === fenceReal || stateReal.startsWith(fenceReal + sep)) return true;
  }
  return false;
}

function genesis(ownerRoot: AumlokAuthorityRootV2): TrustedStateV1 {
  return {
    schema: 'aukora-trusted-state-v1',
    salama: { active: false, reason: null },
    trustedRoots: [ownerRoot],
    consumedIds: [],
    receiptHead: { count: 0, headHash: null },
  };
}

export class DurableCandidateReferenceMonitor extends CandidateReferenceMonitor {
  /**
   * @param stateDir protected trusted-state directory — MUST live outside the repo working tree and outside any
   *                 disposable worktree base (it must survive candidate cleanup). 0700/0600, single-writer.
   * @param crashHook TEST-ONLY fault injection forwarded to the store's journal steps. Never set in production.
   */
  constructor(
    private readonly root: AumlokAuthorityRootV2,
    private readonly stateDir: string,
    private readonly crashHook?: CrashHook,
  ) {
    super(root);
  }

  /** The durable consumed set (journalled truth, lock-free read). Empty when nothing was ever consumed. */
  override consumed(): readonly string[] {
    try {
      return new TrustedStateStore(this.stateDir).load(genesis(this.root)).state.consumedIds;
    } catch {
      return []; // informational read only — decisions always go through the fail-closed path below
    }
  }

  /**
   * The ONE canonical authorization for a candidate effect, made DURABLE: on `allowed` the consumption + PREPARED
   * descriptor are crash-safely committed before this method returns. Every store failure refuses.
   */
  override decide(candidate: BranchCandidate, auth: SignedPromotionV2 | undefined, nowMs: number, opts: { ownerArmed?: boolean; headBefore?: string } = {}): MonitorDecision {
    const { request, payloadHash } = buildCandidateKernelRequest(candidate, auth, opts.ownerArmed === true, opts.headBefore);
    const refused = (code: string): MonitorDecision =>
      ({ allowed: false, code, ring: 'self-modify', authorizedRootId: null, payloadHash, receiptDraftHash: null });

    const store = new TrustedStateStore(this.stateDir, this.crashHook ? { crashHook: this.crashHook } : {});
    let opened = false;
    try {
      store.open(); // single-writer O_EXCL — a concurrent ceremony refuses here, never double-consumes
      opened = true;
      const outcome = store.authorizeAndPrepare({
        genesis: genesis(this.root),
        request,
        policyBytes: candidatePolicyBytes(),
        // Content-free descriptor of THE effect this consumption authorizes: the candidate branch, bound by hash.
        effect: {
          effectId: candidate.candidateId,
          descriptorKind: 'git-candidate',
          targetPath: candidateBranchName(candidate),
          contentHash: payloadHash,
        },
        nowMs,
      });
      if (!outcome.ok) {
        return { allowed: false, code: outcome.decision.code, ring: outcome.decision.ring, authorizedRootId: null, payloadHash, receiptDraftHash: null };
      }
      // Durable receipt lineage lives in the store (receiptHead); the draft hash is not re-derived here.
      return { allowed: true, code: outcome.decision.code, ring: outcome.decision.ring, authorizedRootId: outcome.decision.authorizedRootId, payloadHash, receiptDraftHash: null };
    } catch (e) {
      if (e instanceof TrustedStoreUnsafePathError) return refused('trusted_state_unsafe_path'); // symlink/path swap
      if (e instanceof WriterLockedError) return refused('trusted_state_locked');
      if (e instanceof RollbackRefusedError) return refused('trusted_state_rollback');
      if (e instanceof TrustedStoreCorruptError) return refused('trusted_state_corrupt');
      return refused('trusted_state_unavailable'); // any journal/disk failure — fail closed, nothing consumed
    } finally {
      if (opened) { try { store.close(); } catch { /* lock release is best-effort; a dead-pid lock is reclaimable */ } }
    }
  }
}

/** HARD: durable persistence adds no authority — the kernel `decide()` it journals already grants none. */
export function durableCandidateMonitorGrantsAuthority(): false {
  return false;
}
