// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Live EffectOps adapter (R54) — an exported, runnable, but **FOUNDATION-ONLY** adapter that composes the
 * effect-lifecycle coordinator with a real candidate materialization by delegating to the existing hardened
 * `localCandidateStage` THROUGH `driveEffect`. It is proven end-to-end, but is NOT yet on the primary door path:
 * active primary-door integration (switching `localCeremonyRunner`'s materialize step to `runLiveCandidateEffect`)
 * remains deferred and lives on that protected surface.
 *
 * It adds NO new state machine, store, or protocol. It composes what already exists on main:
 *   - PREPARED (durable) authority   ← Sam 2's `DurableCandidateReferenceMonitor` (the sole durable PREPARED
 *                                       authority store; consumption + content-free PREPARED descriptor are
 *                                       journalled through `@aukora/kernel-node`'s crash-safe store BEFORE any git);
 *   - the ONE effect (isolated git)  ← `localCandidateStage.materializeCandidate` (hardened trusted-git cell);
 *   - isolation before/after         ← `refSnapshot` (protected refs + tree);
 *   - projection-only settlement     ← `effectSettlement.validateSettlement` (never authority; a projection
 *                                       failure returns unsettled → reconcile, and can NEVER describe the effect
 *                                       as absent — the durable consume is the source of truth);
 *   - content-free audit             ← `effectAudit.EffectAuditLedger`.
 *
 * Crash-safety comes for free from the composition: the durable monitor consumes-once, so `runGitEffect` can never
 * double-run git — a restarted process's `materializeCandidate` REPLAY-refuses, and this adapter then OBSERVES the
 * existing candidate branch instead of re-executing. `driveEffect` turns that observation into COMMITTED (present +
 * durable completion), RECONCILE_REQUIRED (present + ambiguous completion), or QUARANTINED (absent / isolation
 * violated). Grants no authority; the ONE authority remains the kernel `decide()` inside the durable monitor.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { ReactiveMemoryStore } from '@aukora/brain';
import type { SignedPromotionV2, AumlokAuthorityRootV2 } from '@aukora/kernel/schemas';
import { driveEffect, type EffectOps, type EffectRunResult, type EffectRunPhase } from './effectCoordinator.js';
import { CandidateReferenceMonitor, type DurableEffectMonitor } from './candidateReferenceMonitor.js';
import { materializeCandidate, candidateBranchName, type CandidateMaterialization } from './localCandidateStage.js';
import { deriveDraftHash } from './proposal.js';
import { snapshotProtected, verifyIsolation, type RefReader, type ProtectedSnapshot } from './refSnapshot.js';
import { EffectAuditLedger } from './effectAudit.js';
import { validateSettlement } from './effectSettlement.js';
import type { BranchCandidate } from './ideEnvelope.js';

/** The protected refs an isolated candidate must never move. */
const PROTECTED_REFS = ['HEAD', 'refs/heads/main'] as const;

/** Observation-only git reader (rev-parse + status/diff reads) over the repo root — never mutates, never runs the
 *  effect. `readTreeHash` is the CHECKOUT-TRUTH digest, not just the committed tree (see below). */
function gitRefReader(repoRoot: string): RefReader {
  const rev = (ref: string): string | null => {
    try {
      const out = execFileSync('git', ['-C', repoRoot, 'rev-parse', '--verify', '--quiet', ref], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      return out.length > 0 ? out : null;
    } catch { return null; }
  };
  const raw = (args: readonly string[], fallback: string): string => {
    try {
      return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { return fallback; }
  };
  // CHECKOUT TRUTH (R54 v6): `HEAD^{tree}` alone is blind to UNCOMMITTED primary mutation — a file edited, staged,
  // or planted in the primary checkout mid-effect leaves the committed tree hash unchanged. The digest therefore
  // covers, deterministically: the committed tree, the porcelain status (index + worktree state incl. every
  // untracked path, NUL-delimited), BOTH diffs (staged and unstaged — the actual changed BYTES of tracked files),
  // and the content hash of every untracked file (`hash-object` WITHOUT -w computes and writes nothing). Any
  // uncommitted index/working-tree mutation between the before/after snapshots changes this digest → isolation
  // violation → the effect can never still report COMMITTED. Read failures fold in as distinct sentinels
  // (fail-closed: an unreadable checkout never digests equal to a healthy one by accident).
  const checkoutTruth = (): string => {
    const tree = rev('HEAD^{tree}') ?? 'no-head';
    const status = raw(['status', '--porcelain=v1', '-uall', '-z'], '\x00status-unreadable');
    const stagedDiff = raw(['diff', '--cached', '--no-color', '--no-renames'], '\x00staged-diff-unreadable');
    const unstagedDiff = raw(['diff', '--no-color', '--no-renames'], '\x00unstaged-diff-unreadable');
    const untracked = status.split('\x00').filter((e) => e.startsWith('?? ')).map((e) => e.slice(3)).sort();
    const untrackedHashes = untracked.map((p) => `${p}\x00${raw(['hash-object', '--', p], 'unhashable').trim()}`);
    const h = createHash('sha256');
    for (const part of [tree, status, stagedDiff, unstagedDiff, ...untrackedHashes]) h.update(part).update('\x00\x00');
    return h.digest('hex');
  };
  return {
    readRef: (name) => rev(name),
    readTreeHash: checkoutTruth,
  };
}

/** A read-only git command over the repo root; `null` on any failure (never throws, never mutates). */
function gitReadOnly(repoRoot: string, args: readonly string[]): string | null {
  try {
    return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}

/**
 * EXACT authorized-candidate identity (reads Git AFTER materialization; NEVER trusts `m.branch !== null`). A branch
 * name — and even the right file contents — are attacker-forgeable, so presence is credited ONLY when the observed
 * `candidate/<id>` ref is THIS authorized candidate committed over THIS authorized base, with EXACTLY the authorized
 * change set. `authorizedBase` is the OWNER-APPROVED base (bound into the signed payload) — never a runtime HEAD
 * observation. The commit sha is resolved ONCE and every subsequent read pins that sha (no TOCTOU on the moving ref):
 *   1. the ref exists (else: never created, deleted, or reconciled away → absent);
 *   2. the commit has a SINGLE parent equal to `authorizedBase` (else: wrong base, rebased, merge, or a branch
 *      squatted over a different history → absent);
 *   3. the change set base→candidate is EXACTLY the authorized candidate file paths — no missing file AND no
 *      unauthorized EXTRA change piggy-backed onto the commit (else → absent);
 *   4. every authorized file's blob in the candidate tree content-binds to its signed `draftHash` (the same binding
 *      the kernel monitor authorized) (else: forged content → absent).
 * Any deviation FAILS CLOSED (returns false) so a hostile, drifted, or partially-formed branch is never credited.
 */
function exactAuthorizedCandidatePresent(repoRoot: string, branch: string, candidate: BranchCandidate, authorizedBase: string): boolean {
  // (1) resolve the observed ref to an IMMUTABLE commit sha; pin every further read to that sha.
  const commit = gitReadOnly(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`]);
  if (commit === null || commit.length === 0) return false;
  // (2) single parent, exactly the authorized base. `rev-list --parents -n 1` → "<commit> <parent...>".
  const lineage = gitReadOnly(repoRoot, ['rev-list', '--parents', '-n', '1', commit]);
  if (lineage === null) return false;
  const ids = lineage.split(/\s+/).filter((s) => s.length > 0);
  if (ids.length !== 2 || ids[1] !== authorizedBase) return false; // 0 parents (root), a merge (≥2), or wrong base
  // (3) the change set base→candidate is EXACTLY the authorized file paths (rename detection disabled so a rename
  //     cannot masquerade as an in-place edit; every literal changed path must be an authorized one, and vice-versa).
  const diff = gitReadOnly(repoRoot, ['diff', '--no-renames', '--name-only', authorizedBase, commit]);
  if (diff === null) return false;
  const changed = diff.split('\n').map((s) => s.trim()).filter((s) => s.length > 0).sort();
  const expected = candidate.files.map((f) => f.path).slice().sort();
  if (changed.length !== expected.length || changed.some((p, i) => p !== expected[i])) return false;
  // (4) content identity of every authorized file against its signed draftHash.
  for (const f of candidate.files) {
    let blob: string;
    try {
      blob = execFileSync('git', ['-C', repoRoot, 'show', `${commit}:${f.path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return false; // an authorized file is missing from the observed tree → not our candidate
    }
    const recomputed = deriveDraftHash({ id: 'candidate', targetPath: f.path, newContent: blob, createdAt: '2026-01-01T00:00:00.000Z', supersedes: null });
    if (recomputed !== f.draftHash) return false; // content mismatch → forged/wrong branch → fail closed
  }
  return true;
}

export interface LiveEffectInput {
  readonly repoRoot: string;
  readonly worktreeBase: string;
  /** The passed-rehearsal, staged candidate (its files already carry rehearsal receipts). */
  readonly candidate: BranchCandidate;
  /** The owner's hybrid authorization over the HEAD-BOUND candidate payload hash (verified by the durable monitor).
   *  It must be signed over `candidatePayloadHash(candidate, expectedHeadBefore)` — the signed bytes bind the base. */
  readonly candidateAuth: SignedPromotionV2 | undefined;
  /** The exact 40-hex base commit the OWNER'S APPROVAL was signed against — NOT a runtime observation. REQUIRED on
   *  the live path: it selects the head-bound signed payload (a mismatched claim refuses `authority_invalid` at the
   *  owner gate), it is enforced against the ACTUAL repo head by the stage's stale-head precheck BEFORE the durable
   *  consume, and it is the base the observed candidate must be parented on to ever be credited as present. */
  readonly expectedHeadBefore: string;
  /** The owner has explicitly ARMED materialization (kernel humanClearance). */
  readonly ownerArmed: boolean;
  /** The trusted owner root — used ONLY for the non-consuming pre-authorization verdict at the owner gate. */
  readonly ownerRoot: AumlokAuthorityRootV2;
  /** The durable reference-monitor contract (decide + consumed). The live door supplies Sam 2's concrete
   *  `DurableCandidateReferenceMonitor` over a protected trusted-state dir (the SOLE durable PREPARED store); the
   *  exported interface lets external callers name the parameter without depending on that barrel-private class. */
  readonly monitor: DurableEffectMonitor;
  readonly store: ReactiveMemoryStore;
  /** Optional projection sink; returns false to simulate a projection outage (→ reconcile, never "absent"). */
  readonly project?: (settlement: unknown) => boolean;
  readonly nowMs: number;
  readonly nowIso: string;
}

/** The NON-RETRYABLE durable-store faults (Sam 2 advisory): surfaced for operator triage, distinct from a retryable
 *  lock/outage. A rolled-back or corrupt trusted-state store — or (Sam 2 v4 store-open contract) a refused
 *  path-swap (`trusted_state_unsafe_path`, the store opening onto a hostile symlink) — needs attention, not a
 *  blind retry. Forward-compatible: `unsafe_path` simply never matches until Sam 2's v4 store lands. */
const NON_RETRYABLE_STORE_FAULT = /\((trusted_state_(?:rollback|corrupt|unsafe_path))\)/;

/** Mutable sink the run entry reads back after `driveEffect` — surfaces a non-retryable store fault, the exact
 *  stage refusal class (e.g. `candidate:stale-head`) when the ONE materialization was refused, and the underlying
 *  `CandidateMaterialization` itself (so a primary caller can preserve its existing materialization contract while
 *  the coordinator governs crash-safety/isolation/settlement on top). `materialization` is null when the owner gate
 *  refused before the effect ran. */
export interface LiveEffectSink {
  storeFault: string | null;
  stageRefusal: string | null;
  materialization: CandidateMaterialization | null;
}

/** Build the concrete `EffectOps` for one live candidate effect. Pure composition over the merged primitives. */
export function liveEffectOps(input: LiveEffectInput, audit: EffectAuditLedger, sink: LiveEffectSink = { storeFault: null, stageRefusal: null, materialization: null }): EffectOps {
  const { repoRoot, worktreeBase, candidate, candidateAuth, ownerArmed, monitor, store, nowMs, nowIso } = input;
  const branch = candidateBranchName(candidate);
  const reader = gitRefReader(repoRoot);
  // The base the authorized candidate MUST be parented on: the base THE OWNER APPROVED (bound into the signed
  // payload) — NEVER a runtime HEAD observation, which would let a stale authorization bind to whatever the repo
  // happens to point at now. The stage separately enforces ACTUAL head == this approved base before the durable
  // consume, so a moved head is an exact stale-head refusal, and a forged claim breaks the signature.
  const authorizedBase = input.expectedHeadBefore;
  let completionRef: string | null = null; // the durable completion receipt from the ONE materialization

  return {
    // The staged candidate must carry a passed rehearsal (every file has a receipt). An empty candidate or a
    // missing/blank receiptHash is a REFUSAL — never a pass. Truthful status: 'passed' only when it truly passed.
    rehearse: () => {
      const passed = candidate.files.length > 0 && candidate.files.every((f) => typeof f.receiptHash === 'string' && f.receiptHash.length > 0);
      return { proceed: passed, status: passed ? 'passed' : 'failed' };
    },
    // OWNER GATE = the kernel authorization verdict, NON-CONSUMING (a fresh base monitor with empty consumed state
    // runs the SAME `decide()` logic and its in-memory consume is discarded). A forged/absent/unarmed authorization
    // refuses HERE — before EXECUTING/audit/Git. The ONE DURABLE PREPARED transition (the authoritative consume)
    // remains solely Sam 2's durable monitor inside `runGitEffect` (no second store, no second durable authority).
    // A replayed (already-durably-consumed) but valid authorization still verifies allowed here and flows on to be
    // reconciled by observing reality in `runGitEffect` — the owner gate rejects forgery, not replay.
    // The verify is over the HEAD-BOUND payload: an authorization signed for a different base — or a runtime lying
    // about `expectedHeadBefore` to dodge the stale-head check — hashes differently and refuses here.
    ownerAuthorize: () => ({ authorized: new CandidateReferenceMonitor(input.ownerRoot).decide(candidate, candidateAuth, nowMs, { ownerArmed, headBefore: input.expectedHeadBefore }).allowed }),
    // Identity only; the DURABLE PREPARED consume is journalled inside runGitEffect BEFORE any git (Sam 2's monitor).
    prepare: () => ({ effectId: candidate.candidateId, candidateBranch: branch }),
    snapshotBefore: () => snapshotProtected(reader, PROTECTED_REFS, nowIso),
    runGitEffect: (_effectId) => {
      // The ONE effect. The durable monitor consumes-once BEFORE git; a replay (post-crash restart) refuses here,
      // so git never double-runs — we then OBSERVE the existing candidate rather than re-executing.
      // `expectedHeadBefore` rides into the stage: its stale-head precheck refuses a moved head BEFORE the durable
      // consume, and `authBindsHead` makes its decide() call verify the head-bound signature (the ONE consume)
      // over the same base — the live path never accepts a head-free authorization.
      const m = materializeCandidate({ repoRoot, worktreeBase, candidate, candidateAuth, monitor, ownerArmed, store, nowMs, nowIso, expectedHeadBefore: input.expectedHeadBefore, authBindsHead: true });
      completionRef = m.ok ? m.receiptHash : null;
      sink.materialization = m;                     // the underlying materialization (branch/commitSha/receipts) for a primary caller
      if (!m.ok) sink.stageRefusal = m.reasonClass; // the EXACT stage refusal (content-free class), e.g. candidate:stale-head
      // Advisory (Sam 2): surface a NON-RETRYABLE durable-store fault (rollback/corrupt) for operator triage — a
      // retryable lock/outage is NOT surfaced. The effect still quarantines/reconciles; this only names the fault.
      if (!m.ok && m.reasonClass === 'candidate:reference-monitor-refused') {
        sink.storeFault = NON_RETRYABLE_STORE_FAULT.exec(m.text)?.[1] ?? sink.storeFault;
      }
      // OBSERVE REALITY by RE-READING Git after materialization — on BOTH paths, never trusting `m.branch !== null`
      // as proof. Presence requires the observed candidate/<id> to be EXACTLY this authorized candidate over the
      // authorized base with exactly the authorized change set (see `exactAuthorizedCandidatePresent`). A fresh
      // success verifies as itself; a hostile squat, a wrong-base commit, an extra piggy-backed change, or a
      // deleted/forged branch all fail closed → treated as absent (→ QUARANTINED, never COMMITTED).
      const candidatePresent = exactAuthorizedCandidatePresent(repoRoot, branch, candidate, authorizedBase);
      return { candidatePresent, completionRef, snapshotAfter: snapshotProtected(reader, PROTECTED_REFS, nowIso) };
    },
    verifyIsolation: (before, after) => ({ intact: verifyIsolation(before as ProtectedSnapshot, after as ProtectedSnapshot).ok }),
    // Projection-ONLY: validate the terminal projection; a projection sink outage → unsettled (reconcile), never absent.
    settle: (projection) => {
      const settlement = {
        schema: 'aukora-effect-settlement-v1' as const,
        effectId: projection.effectId, phase: settleablePhase(projection.phase),
        candidateBranch: branch, completionRef: projection.completionRef,
        updatedAtIso: nowIso, advisoryOnly: true as const, grantsAuthority: false as const,
      };
      if (!validateSettlement(settlement).ok) return { ok: false };
      // A projection sink that THROWS is an outage exactly like one that returns false: it must surface as
      // unsettled (→ RECONCILE_REQUIRED, audited by the coordinator) — never escape as an exception AFTER the
      // durable consume + git effect, which would leave the run's terminal state unreported.
      let projected: boolean;
      try {
        projected = input.project ? input.project(settlement) : true;
      } catch {
        projected = false;
      }
      return { ok: projected };
    },
    audit: (effectId, toPhase, hasCompletionRef) => ({ ok: audit.append({ effectId: effectId ?? candidate.candidateId, fromPhase: null, toPhase, hasCompletionRef, at: nowIso }).ok }),
  };
}

/** Map a coordinator run-phase to the settleable subset (COMMITTED settles; the coordinator never settles a
 *  non-terminal or EXECUTING phase). */
function settleablePhase(phase: EffectRunPhase): 'COMMITTED' | 'QUARANTINED' | 'RECONCILE_REQUIRED' | 'REFUSED' {
  return phase === 'COMMITTED' ? 'COMMITTED' : phase === 'QUARANTINED' ? 'QUARANTINED' : phase === 'RECONCILE_REQUIRED' ? 'RECONCILE_REQUIRED' : 'REFUSED';
}

export interface LiveEffectResult extends EffectRunResult {
  /** The content-free audit trail of the run (phase labels only). */
  readonly auditTrail: ReadonlyArray<{ readonly toPhase: string; readonly hasCompletionRef: boolean }>;
  /** A NON-RETRYABLE durable-store fault (`trusted_state_rollback` / `trusted_state_corrupt` / — under Sam 2's v4
   *  store-open contract — `trusted_state_unsafe_path`) if one occurred, for operator triage. `null` when the store
   *  was healthy (a retryable lock/outage is deliberately not reported here). */
  readonly storeFault: string | null;
  /** The EXACT stage refusal class when the ONE materialization was refused (e.g. `candidate:stale-head`,
   *  `candidate:already-materialized`, `candidate:reference-monitor-refused`); `null` when it succeeded. Content-free
   *  (a class label, never file content) — lets a caller/test pin the precise refusal, not just the terminal phase. */
  readonly stageRefusal: string | null;
  /** The underlying `CandidateMaterialization` (branch/commitSha/receipts) from the ONE governed effect, so a
   *  primary caller keeps its existing materialization contract; `null` when the owner gate refused before the
   *  effect ran. */
  readonly materialization: CandidateMaterialization | null;
}

/**
 * Run ONE live candidate effect through the lifecycle coordinator. It drives the real durable monitor + hardened
 * candidate stage through `driveEffect`. R56: this is now the PRIMARY ceremony materialization path
 * (`localCeremonyRunner` delegates its effect step here); direct `materializeCandidate()` lives ONLY inside this
 * adapter's `runGitEffect`, never beside it. Returns the coordinator verdict, the content-free audit trail, and
 * the underlying materialization. No authority minted here; the durable monitor holds the ONE authorization.
 */
export function runLiveCandidateEffect(input: LiveEffectInput): LiveEffectResult {
  const audit = new EffectAuditLedger();
  const sink: LiveEffectSink = { storeFault: null, stageRefusal: null, materialization: null };
  const result = driveEffect(liveEffectOps(input, audit, sink));
  return { ...result, auditTrail: audit.log().map((e) => ({ toPhase: e.toPhase, hasCompletionRef: e.hasCompletionRef })), storeFault: sink.storeFault, stageRefusal: sink.stageRefusal, materialization: sink.materialization };
}

/** HARD: the adapter composes existing governed pieces; it signs nothing, pushes nothing, mints no authority. */
export function liveEffectOpsGrantsAuthority(): false {
  return false;
}
