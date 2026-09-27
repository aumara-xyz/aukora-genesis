// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * R5 edge adapter — builds the REAL reader-signature producer for core/src/memoryRecall.ts from the
 * kernel's OWN recall-head + ML-DSA-65 signer, so a client signature can never drift from what the kernel
 * verifies. This lives in scripts/ (not core/) precisely because it imports convex/ — core/ is typechecked
 * in isolation by the sandbox runner and must stay convex-free (see core/src/memoryRecall.ts header).
 *
 * Reads the owner root seed under strict custody (readOwnerSeedStrict) and returns a RecallSigner closure.
 * NOT wired into any lane yet — the fuzzy recall cutover waits for the R5b search brick (docs/R5_RECALL_STATUS.md).
 */
import {
  readOwnerSeedStrict,
  MEMORY_ROOT_SEED_PATH,
  recallMemoriesByQuery,
  recallMemoryByKey,
  peekRecentMemories,
  type RecallSigner,
  type SearchSigner,
  type RecentSigner,
  type RecallByQueryResult,
  type MemoryRecallResult,
  type RecentMemoryPeekResult,
} from '../core/src/memoryRecall';
import { readAdminKeyStrict } from '../core/src/memoryKernelTransport';
import { recallHead, searchHead, recentHead } from '../convex/aumlokMemory';
import { signChainHeadV3 } from '../convex/aukoraSignedHead';

/** Build the owner-root RecallSigner. The seed is read ONCE under custody at build time; the returned
 *  closure signs each recall head under the dedicated `aumlokMemRecall` domain. */
export function buildOwnerRecallSigner(seedPath: string = MEMORY_ROOT_SEED_PATH): RecallSigner {
  const seed = readOwnerSeedStrict(seedPath); // throws loud + typed on custody violation
  return async (req) => signChainHeadV3(seed, await recallHead(req), 'aumlokMemRecall');
}

/** Build the owner-root SearchSigner (R5b). Same custody law; signs each SEARCH head under the
 *  dedicated `aumlokMemSearch` domain — the query text rides inside the signed preimage. */
export function buildOwnerSearchSigner(seedPath: string = MEMORY_ROOT_SEED_PATH): SearchSigner {
  const seed = readOwnerSeedStrict(seedPath); // throws loud + typed on custody violation
  return async (req) => signChainHeadV3(seed, await searchHead(req), 'aumlokMemSearch');
}

/** Build the owner-root RecentSigner. Same custody law; signs each recent-list head under the dedicated
 *  `aumlokMemRecent` domain so a bounded "show me the latest rows" read is chain-id separated from
 *  search/recall/erase. */
export function buildOwnerRecentSigner(seedPath: string = MEMORY_ROOT_SEED_PATH): RecentSigner {
  const seed = readOwnerSeedStrict(seedPath);
  return async (req) => signChainHeadV3(seed, await recentHead(req), 'aumlokMemRecent');
}

const OWNER_ROOT_ID = 'aumara.root'; // the M4/capture constant — one owner root per node

/** One-call KEYED point read under the owner root (custody at call time, same law as below).
 *  Used by the working-focus register's read side (spatial/workingFocus.ts → core/src/focusRegister.ts). */
export async function ownerRecallByKey(key: string): Promise<MemoryRecallResult> {
  return recallMemoryByKey(key, {
    ownerRootId: OWNER_ROOT_ID,
    adminKeyProvider: () => readAdminKeyStrict(),
    signRecall: buildOwnerRecallSigner(),
  });
}

/** One-call fuzzy recall against the local governed brain, for the flag-gated lane router
 *  (spatial/recallSource.ts lazy-loads this exactly as shadowCapture lazy-loads its adapter).
 *  Custody reads happen at CALL time so a custody violation is a per-turn loud refusal the router
 *  can fall back from — never a cached success. */
export async function convexRecallByQuery(query: string, k: number): Promise<RecallByQueryResult> {
  return recallMemoriesByQuery(query, k, {
    ownerRootId: OWNER_ROOT_ID,
    adminKeyProvider: () => readAdminKeyStrict(),
    signSearch: buildOwnerSearchSigner(),
    signRecall: buildOwnerRecallSigner(),
  });
}

/** Bounded newest-first observability read from the governed brain. Owner-root only, metadata→point-read:
 *  the recent query returns keys+timestamps, and content still comes back only through the integrity-
 *  checked point-read road. */
export async function peekRecentOwnerMemories(limit: number): Promise<RecentMemoryPeekResult> {
  return peekRecentMemories(limit, {
    ownerRootId: OWNER_ROOT_ID,
    adminKeyProvider: () => readAdminKeyStrict(),
    signRecent: buildOwnerRecentSigner(),
    signRecall: buildOwnerRecallSigner(),
  });
}
