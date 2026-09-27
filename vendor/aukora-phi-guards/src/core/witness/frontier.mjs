// aukora · core/witness/frontier.mjs — WITNESSING A CHAIN THAT FORKS
//
// ══ THE DEFECT THIS REPLACES, MEASURED ══
//
// The chain deliberately permits forks, and `chain.mjs` is right about why: two guard processes
// reading the same head and both appending costs a TOTAL ORDER, not integrity. Every receipt still
// hashes to what it claims.
//
// But `writeCheckpoint` signs `readHead()` — ONE head — and the peer push shipped in #122 carried a
// single `head` field while its own comments said "the witness holds the head we hold". On the
// owner's live node the day this was written:
//
//     8,533 receipts · 52 heads · 67 forks · intact: true
//
// So the witness held one of fifty-two. **Delete an entire branch and the peer still agrees.**
// Building transport on that would have operationalised false agreement.
//
// ══ WHAT A FRONTIER COMMITS ══
//
//   receiptCount     how many receipts — the number truncation cannot survive
//   prefixDigest     ORDER-SENSITIVE digest over every receipt hash, so a rewrite that preserves
//                    length is caught too. A reordering is a rewrite.
//   frontierDigest   digest over the SORTED SET of heads. Sorted because head order is a race
//                    artefact, and a digest that changed when two processes interleaved would report
//                    a rewrite on the honest case this chain exists to permit.
//   frontierCount    how many heads, so losing a branch is visible as a number as well as a digest
//   repoId           which record
//   writerEpoch      which machine — `writerId()`, minted once and stable across every run of it, NOT
//                    per run despite the name. See `peer.mjs` on the clone problem
//   policyVersions   which semantics produced these receipts
//
// ══ THE HEAD-SET DIGEST IS ABSORBED; THE PREFIX HALF HAD TO BE REPLACED ══
//
// `core/acp/checkpoint.ts` implements `count`, `head`, a `root` digest over ordered entry hashes, and a
// comparison that tolerates growth while catching truncation and prefix rewriting. Its growth-tolerant
// shape is still the model here, and `rootOf` is still imported from it rather than rewritten — but it
// now supplies only `frontierDigestOf`, the SORTED HEAD SET half.
//
// The prefix half is deliberately a SECOND definition, which this header previously said was exactly
// what to avoid. The reason it had to change: `rootOf` is a sha256 over a concatenated list, and you
// cannot continue a sha256 from its output. A witness holding D(n) could not check a claim about
// D(n+1) without being handed all n+1 hashes again — so the digest was correct and useless to the one
// party that has to check it. The domain-separated fold below is resumable, which is the whole point.

import { createHash } from 'node:crypto';

import { readAll } from './chain.mjs';
import { repoIdentity } from './identity.mjs';
import { writerId } from './peer.mjs';
import { rootOf } from '../acp/checkpoint.ts';

export const FRONTIER_SCHEMA = 'aukora-frontier-v2';

// ══ THE HOLE v1 SHIPPED WITH, AND WHY THE SCHEMA HAD TO CHANGE ══
//
// Two reviewers reproduced the same defect independently:
//
//   CODEX  retain {count 3, prefix A} · push {count 4, prefix B}          → ACCEPTED
//   SOL    rewrite the first 100 receipts, append one, push count 101     → ACCEPTED as EXTENDED
//
// `compareFrontier` treated ANY higher count as an extension. It had to: with two opaque digests and
// no chain bytes it cannot tell an extension from a forgery. The strong check that could — one this
// file already contained — HAD ZERO CALLERS. And the `ok: true` it returned carried a reason string
// naming that uncalled function, so a verdict shipped with a reassurance pointing at a check nobody
// ran. A comment is not a caller.
//
// The real problem is structural, not a missing call site: `verifyFrontierAgainstChain` needs the
// LEDGER, and a witness on another machine does not have it. That is the entire reason it is a
// witness. So the proof has to travel WITH the push.
//
// ══ AN ACCUMULATOR IS RESUMABLE; A DIGEST OVER A LIST IS NOT ══
//
//     D₀ = H(domain)                    D_i = H(domain ‖ D_{i-1} ‖ receiptHash_i)
//
// v1's `prefixDigest` was `sha256(h₁ ‖ h₂ ‖ …)`. Correct, and useless to a remote party: you cannot
// continue a sha256 from its output, so a witness holding D(100) could not check a claim about D(101)
// without being handed all 101 hashes again. Folded this way it can: hold D(100), receive the ONE
// appended hash, fold, compare. The witness verifies continuity from what it already retained.
//
// The domain constant is mixed at every step so an accumulator can never be confused with a bare
// hash, or with a digest computed for some other purpose over the same bytes.

const ACC_DOMAIN = 'aukora-frontier-accumulator-v2';

/** D₀. Not the empty string: an empty chain has a stated digest, so "no receipts" cannot be forged
 *  by omitting the field. `absent ≠ empty` is the same rule the allow-list follows. */
export const GENESIS_ACC = createHash('sha256').update(ACC_DOMAIN).digest('hex');

/** One fold step. The whole continuity proof is this function applied repeatedly. */
export function accumulate(prev, receiptHash) {
  return createHash('sha256').update(ACC_DOMAIN).update('\u0000').update(String(prev)).update('\u0000').update(String(receiptHash)).digest('hex');
}

/** What a delta can conclude. Separate names because they call for different actions. */
export const DELTA_STATES = Object.freeze({
  AGREED: 'delta:agreed',
  EXTENDED: 'delta:extended',
  /**
   * A witness JOINING A CHAIN THAT ALREADY EXISTS, at first contact only.
   *
   * MEASURED, and this is why it exists: on the owner's real node a first push replaying from genesis
   * weighed 803,982 bytes over 11,993 receipts. Nobody carries 785 KB by hand, and a human carrying the
   * file is the entire design. So First Echo worked between two fresh test machines and could not run
   * against the record it exists to witness.
   *
   * A witness that arrives at count N cannot verify receipts 1..N — it was not there, and no protocol
   * puts it there. The honest choice is between handing it the whole history and having it SAY that it
   * starts here. This is the second, and the cost is on the record rather than in a comment: an
   * anchored checkpoint cannot detect a rewrite BELOW itself, the retained row is marked, and
   * everything after it is replayed in full.
   */
  ANCHORED: 'delta:anchored',
  WRONG_ANCESTOR: 'delta:wrong-ancestor',
  PREFIX_REWRITTEN: 'delta:prefix-rewritten',
  COUNT_MISMATCH: 'delta:count-mismatch',
  FOREIGN: 'delta:different-record',
  MALFORMED: 'delta:malformed',
});

/**
 * What a comparison can conclude. Only the first two are ok, and each failure is named separately
 * because they call for different actions: a truncation is a deletion, a rewritten prefix is a
 * forgery, and a lost branch is a deletion the old single-head checkpoint could not see at all.
 */
export const FRONTIER_STATES = Object.freeze({
  AGREED: 'frontier:agreed',
  EXTENDED: 'frontier:extended',
  TRUNCATED: 'frontier:truncated',
  PREFIX_REWRITTEN: 'frontier:prefix-rewritten',
  BRANCH_LOST: 'frontier:branch-lost',
  FOREIGN: 'frontier:different-record',
});

/** Order-SENSITIVE, and RESUMABLE — fold, don't hash-the-list. A reordering is a rewrite. */
export function prefixDigestOf(hashes) {
  let d = GENESIS_ACC;
  for (const h of hashes) d = accumulate(d, h);
  return d;
}

/** Order-INSENSITIVE. Head order is a race artefact; the SET is the fact. */
export function frontierDigestOf(headHashes) {
  return rootOf([...headHashes].sort());
}

/** The frontier of this repository's chain, right now. */
export function frontierOf(repoRoot) {
  const { records } = readAll(repoRoot);
  const hashes = records.map((r) => r.entry?.hash).filter((h) => typeof h === 'string');

  // A head is a hash nothing else names as its predecessor.
  const claimed = new Set(records.map((r) => r.entry?.prev).filter(Boolean));
  const heads = hashes.filter((h) => !claimed.has(h));

  const policies = [...new Set(records.map((r) => (typeof r.entry?.policyVersion === 'string' ? r.entry.policyVersion : null)))];

  return {
    schema: FRONTIER_SCHEMA,
    repoId: repoIdentity(repoRoot).id ?? null,
    writerEpoch: writerId(),
    receiptCount: hashes.length,
    prefixDigest: prefixDigestOf(hashes),
    frontierDigest: frontierDigestOf(heads),
    frontierCount: heads.length,
    policyVersions: policies,
  };
}

/**
 * Does `now` honestly extend `then`?
 *
 * GROWTH IS THE NORMAL CASE and must not read as tampering — that is the property `acp/checkpoint`
 * already got right and the one a naive equality check destroys. What may not happen is disagreement
 * about the prefix the witness already saw, or the quiet disappearance of a branch it counted.
 *
 * The COUNT is branched on first, and the prefix digest is compared only where the counts are equal.
 * That is not an oversight to be reordered: under the fold above, two prefix digests over different
 * lengths are incomparable by construction, so comparing them across unequal counts would turn every
 * honest truncation into a forgery accusation. Where the counts match, a differing digest IS a
 * length-preserving rewrite and is reported as one.
 */
export function compareFrontier(now, then) {
  if (!now || !then) return { ok: false, state: FRONTIER_STATES.FOREIGN, reason: 'one side has no frontier to compare' };
  if (now.repoId !== then.repoId || now.writerEpoch !== then.writerEpoch) {
    return {
      ok: false, state: FRONTIER_STATES.FOREIGN,
      reason: `this frontier is about ${then.repoId}/${then.writerEpoch}, not ${now.repoId}/${now.writerEpoch}`,
    };
  }

  if (now.receiptCount === then.receiptCount) {
    if (now.prefixDigest !== then.prefixDigest) {
      return { ok: false, state: FRONTIER_STATES.PREFIX_REWRITTEN, reason: 'the same number of receipts, and different bytes — a rewrite that preserved the length' };
    }
    if (now.frontierDigest !== then.frontierDigest) {
      return { ok: false, state: FRONTIER_STATES.BRANCH_LOST, reason: 'the prefix matches but the set of heads does not — a branch was replaced' };
    }
    return { ok: true, state: FRONTIER_STATES.AGREED, reason: null };
  }

  if (now.receiptCount < then.receiptCount) {
    return {
      ok: false, state: FRONTIER_STATES.TRUNCATED,
      reason: `${then.receiptCount - now.receiptCount} receipt(s) have been removed since this was witnessed`
        + (now.frontierCount < then.frontierCount ? `, and ${then.frontierCount - now.frontierCount} head(s) with them` : ''),
    };
  }

  // GREW. The witnessed prefix must still be a prefix — that is the whole claim, and it is why the
  // digest is over the ordered hashes rather than a set.
  if (typeof now.prefixOfLength !== 'function') {
    // The caller holds only digests, not the chain, so a full re-derivation is impossible HERE.
    //
    // Who actually re-checks depends on which caller this is, and the distinction is load-bearing:
    //   · `verifyEverything` — has the repository, and DOES re-derive, via `verifyFrontierAgainstChain`.
    //   · a remote witness    — has no repository and never will. It replays a `FrontierDelta` through
    //                           `verifyDelta` instead, and does not reach this branch at all.
    // For two rounds this comment named the first path as though it covered both, while that function
    // had no callers whatsoever. It has one now; the reason string below says which one.
    return {
      ok: true, state: FRONTIER_STATES.EXTENDED,
      reason: `grew by ${now.receiptCount - then.receiptCount}; a caller holding the chain must still re-derive the witnessed prefix (verifyEverything does)`,
    };
  }
  return { ok: true, state: FRONTIER_STATES.EXTENDED, reason: null };
}

/**
 * The strong form for a party that HAS the ledger — the writer's own node, `verifyEverything`. It
 * re-derives the witnessed prefix from the bytes.
 *
 * This is NOT the check a remote witness runs; it cannot be, because a witness has no ledger. That is
 * `verifyDelta`. Both exist, and both have callers — the second fact being the one v1 lacked.
 */
export function verifyFrontierAgainstChain(repoRoot, then) {
  const now = frontierOf(repoRoot);
  const shallow = compareFrontier(now, then);
  if (!shallow.ok || now.receiptCount === then.receiptCount) return { ...shallow, now };

  const { records } = readAll(repoRoot);
  const hashes = records.map((r) => r.entry?.hash).filter((h) => typeof h === 'string');
  if (prefixDigestOf(hashes.slice(0, then.receiptCount)) !== then.prefixDigest) {
    return {
      ok: false, state: FRONTIER_STATES.PREFIX_REWRITTEN, now,
      reason: `the chain grew, but its first ${then.receiptCount} receipts are no longer the ones that were witnessed`,
    };
  }
  return { ok: true, state: FRONTIER_STATES.EXTENDED, now, reason: null };
}

/**
 * Build the proof that travels with a push.
 *
 * `appended` is the receipt hashes added since `from` — the ONLY bytes the witness needs, and it needs
 * them because a digest alone can be claimed but not replayed.
 */
export function buildDelta({ from, to, appended, anchor = false }) {
  return {
    schema: 'aukora-frontier-delta-v1',
    fromCommitment: from ? { receiptCount: from.receiptCount, prefixDigest: from.prefixDigest } : null,
    toFrontier: to,
    appended: [...(appended ?? [])],
    // DECLARED, never inferred. Without this flag "I sent no history" and "there is no history" are
    // the same bytes — and the second is a claim a witness can check, while the first is one it
    // cannot. An anchor has to say it is one.
    anchor: Boolean(anchor),
  };
}

/**
 * THE CHECK A WITNESS CAN ACTUALLY RUN.
 *
 * Given what it already retained and a delta, it replays the appended hashes and compares. It reads no
 * file, opens no repository, and trusts no count. Deliberately pure: the moment this function needs a
 * `repoRoot` it has stopped being a witness check and become the writer marking its own homework.
 *
 * Order of refusal matters. The ancestor is checked first — a delta built on a frontier the witness
 * never saw is not a rewrite, it is an answer to a different question, and calling it a forgery would
 * send the owner looking for an attacker who is not there.
 */
export function verifyDelta(retained, delta) {
  if (!delta || delta.schema !== 'aukora-frontier-delta-v1' || !delta.toFrontier || !Array.isArray(delta.appended)) {
    return { ok: false, state: DELTA_STATES.MALFORMED, reason: 'not a frontier delta' };
  }
  const to = delta.toFrontier;

  // ══ ANCHORING: FIRST CONTACT WITH AN EXISTING CHAIN ══
  //
  // Accepted ONLY when this witness holds nothing for the pair. Allowing it later would make it a
  // reset — claim any frontier you like and call it a new beginning — which is the deletion attack
  // wearing a different hat.
  if (delta.anchor === true) {
    if (retained) {
      return { ok: false, state: DELTA_STATES.WRONG_ANCESTOR, reason: 'an anchor is first contact only; this witness already holds a history for this pair' };
    }
    if (delta.appended.length > 0) {
      return { ok: false, state: DELTA_STATES.MALFORMED, reason: 'an anchor carries no history; this one carries appended receipts' };
    }
    if (!Number.isFinite(to.receiptCount) || to.receiptCount < 0) {
      return { ok: false, state: DELTA_STATES.MALFORMED, reason: 'an anchor must still state a receipt count' };
    }
    return {
      ok: true, state: DELTA_STATES.ANCHORED,
      reason: `anchored at ${to.receiptCount} receipts — this witness starts here and can say nothing about what came before`,
    };
  }

  if (retained) {
    if (to.repoId !== retained.repoId || to.writerEpoch !== retained.writerEpoch) {
      return { ok: false, state: DELTA_STATES.FOREIGN, reason: `about ${to.repoId}/${to.writerEpoch}, not ${retained.repoId}/${retained.writerEpoch}` };
    }
    const from = delta.fromCommitment;
    if (!from || from.receiptCount !== retained.receiptCount || from.prefixDigest !== retained.prefixDigest) {
      return {
        ok: false, state: DELTA_STATES.WRONG_ANCESTOR,
        reason: `this delta continues from ${from ? `count ${from.receiptCount}` : 'nothing'}, but the witness holds count ${retained.receiptCount}`,
      };
    }
  }

  // The count must equal what was held plus what was shown. A count that outruns the appended hashes
  // is a claim about receipts the witness was never given, which is exactly SOL's probe.
  const base = retained ? retained.receiptCount : 0;
  if (to.receiptCount !== base + delta.appended.length) {
    return {
      ok: false, state: DELTA_STATES.COUNT_MISMATCH,
      reason: `claims ${to.receiptCount} receipts but showed ${delta.appended.length} appended on top of ${base}`,
    };
  }

  // REPLAY. This is the proof.
  let d = retained ? retained.prefixDigest : GENESIS_ACC;
  for (const h of delta.appended) d = accumulate(d, h);
  if (d !== to.prefixDigest) {
    return {
      ok: false, state: DELTA_STATES.PREFIX_REWRITTEN,
      reason: retained
        ? `replaying ${delta.appended.length} appended receipt(s) from the witnessed prefix does not reach the claimed frontier — the first ${retained.receiptCount} receipts are no longer the ones that were witnessed`
        : 'the appended receipts do not digest to the claimed frontier',
    };
  }

  if (delta.appended.length === 0) {
    // Same prefix, same length. The heads may still differ, and a lost branch is a deletion.
    if (retained && to.frontierDigest !== retained.frontierDigest) {
      return { ok: false, state: DELTA_STATES.PREFIX_REWRITTEN, reason: 'the prefix matches but the set of heads does not — a branch was replaced' };
    }
    return { ok: true, state: DELTA_STATES.AGREED, reason: null };
  }
  return { ok: true, state: DELTA_STATES.EXTENDED, reason: `extended by ${delta.appended.length}, replayed and verified from the witnessed prefix` };
}

/**
 * The writer's side: build the delta that proves this chain extends what a witness last retained.
 *
 * `retained` may be null — a first push to a fresh witness proves itself from the genesis accumulator,
 * which costs every receipt hash on the wire exactly once, and never again.
 *
 * A note on size, and it is the same constraint `RECONCILIATION-V1` runs into: `appended` grows with
 * how far behind the witness is, so a witness that has been offline for a month is handed a month of
 * hashes. That is bounded by pushing often, not by trusting more.
 */
export function deltaOf(repoRoot, retained = null) {
  const to = frontierOf(repoRoot);
  const { records } = readAll(repoRoot);
  const hashes = records.map((r) => r.entry?.hash).filter((h) => typeof h === 'string');
  const from = retained ? retained.receiptCount : 0;
  return buildDelta({ from: retained, to, appended: hashes.slice(from) });
}
