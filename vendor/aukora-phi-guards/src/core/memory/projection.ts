// aukora · core/memory/projection.ts — WHAT THE LEDGER STILL ASSERTS
//
// ══ THE HOLE THIS FILLS, MEASURED ══
//
// Every digest in this organ is over the EVENT SEQUENCE:
//
//   hashEvent            one event body                        eventLog.ts:173
//   nextHead             previousHead + eventHash              eventLog.ts:177
//   computeMemoryLogRoot Merkle root over chain HEADS          eventLog.ts:365
//
// Nothing hashes "the set of records that are still alive". That matters enormously for proving a
// forget, and in the most dangerous possible way: **appending a tombstone changes the chain head no
// matter what it does.** So a test that watched `computeMemoryLogRoot` change after a forget would go
// green whether the record left the field or not — it would be watching the append, not the erasure.
//
// And there was no live-set projection to digest either. `viewOf` (eventLog.ts:200) and `ledgerView`
// (vault.ts:105) both compute one and neither is exported; the only exported projections are per-id
// booleans — `isKnownAndLive`, `isReadable`, `keyMaterialSurvives`. A caller could ask about an id it
// already knew and could not enumerate.
//
// So both halves were missing, and either one alone leaves a forget unobservable.
//
// ══ WHY A RECOMPUTATION AND NOT A DELETE ══
//
// Nothing is removed from the log — it is append-only and stays that way. `liveRecords` REPLAYS the
// events and reports what survives; `liveDigest` hashes that. A forget therefore changes the digest
// because the SET IS SMALLER, not because a line was edited or a byte was deleted. That is the whole
// distinction the owner means by burnt and unburnt: the record leaves the field, and the field can be
// recomputed by anyone from the same log.

import { createHash } from 'node:crypto';

import type { CommittedEvent } from './eventLog';

export const LIVE_DIGEST_DOMAIN = 'aukora-memory-live-v1';

/** One record the ledger still asserts. Content-free: digests, references and counts, never plaintext. */
export interface LiveRecord {
  readonly occurrenceId: string;
  readonly ciphertextDigest: string;
  readonly keyRef: string;
  readonly byteLength: number;
  readonly consentScope: string;
  readonly at: string;
}

/**
 * Replay the log and return what is still alive, sorted by `occurrenceId`.
 *
 * SORTED, because the digest below must not depend on the order events happened to arrive in. Two
 * ledgers asserting the same set of records must digest identically or the number is about history
 * rather than about content — and the question this answers is what the ledger says NOW.
 *
 * The forgotten set is the union of every tombstone's `{target} ∪ erased`, which is exactly how
 * `viewOf` reconstitutes it (eventLog.ts:214-217). A `correct` supersedes its predecessor, so the
 * superseded id is live-but-shadowed: it stays known and is NOT in the live set, because the record
 * the ledger currently asserts is the correction.
 */
export function liveRecords(events: readonly CommittedEvent[]): LiveRecord[] {
  const byId = new Map<string, LiveRecord>();
  const superseded = new Set<string>();
  const forgotten = new Set<string>();

  for (const committed of events) {
    const e = committed.event;
    if (e.kind === 'insert' || e.kind === 'correct') {
      byId.set(e.occurrenceId, {
        occurrenceId: e.occurrenceId,
        ciphertextDigest: e.content.ciphertextDigest,
        keyRef: e.content.keyRef,
        byteLength: e.content.byteLength,
        consentScope: e.consentScope,
        at: e.at,
      });
      if (e.kind === 'correct') superseded.add(e.supersedes);
    } else if (e.kind === 'tombstone') {
      forgotten.add(e.target);
      for (const id of e.erased) forgotten.add(id);
    }
  }

  return [...byId.values()]
    .filter((r) => !forgotten.has(r.occurrenceId) && !superseded.has(r.occurrenceId))
    .sort((a, b) => (a.occurrenceId < b.occurrenceId ? -1 : a.occurrenceId > b.occurrenceId ? 1 : 0));
}

/**
 * A digest over what the ledger still asserts.
 *
 * THE ONE PROPERTY THAT MATTERS: this is a function of the live SET, not of the event history. Append a
 * tombstone that forgets nothing and it does not move. Forget a record and it does — because the set
 * it is computed from is smaller.
 *
 * Domain-separated for the same reason everything else in this repository is: a bare sha256 of some
 * JSON is the same digest anything else takes of those bytes.
 */
export function liveDigest(events: readonly CommittedEvent[]): string {
  const h = createHash('sha256').update(LIVE_DIGEST_DOMAIN).update(Buffer.from([0]));
  for (const r of liveRecords(events)) {
    // Field order is fixed here rather than left to JSON key order, so the digest cannot change
    // because somebody reordered an interface.
    h.update(`${r.occurrenceId}\x00${r.ciphertextDigest}\x00${r.keyRef}\x00${r.byteLength}\x00${r.consentScope}\x00${r.at}\x01`);
  }
  return h.digest('hex');
}
